import {
  advanceBalanceDifference,
  advanceReportingPosting,
  advanceUsesPayments,
  advanceVatDifference,
  invoicePaymentPosting,
  totalsFromTaxes,
} from "@haben/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { loadAdvanceVatPlan, refundOnly } from "./advance-vat-plan.ts";
import { UserError } from "../../errors.ts";
import { invoiceTaxReader } from "./invoice-tax.ts";

type Invoice = typeof schema.invoices.$inferSelect;

/** Betroffene Anzahlung oder die in einer Schlussrechnung abgezogenen neuen Anzahlungen. */
async function affectedAdvances(tx: Tx, invoiceId: string) {
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice) return [];
  const original = await invoiceTaxReader(tx).original(invoice);
  // KU hat keine Anzahlungs-USt, benötigt bei GmbH/UG aber denselben Bilanzierungsanschluss.
  if (
    original.id &&
    (original.advanceType === "anzahlung" || (original.variant === null && (original.advanceAccounting === "deferred" || original.status === "draft")))
  )
    return [{ id: original.id }];
  const referenced = await tx
    .selectDistinct({ invoice: schema.invoices })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(and(eq(schema.invoiceLines.invoiceId, invoiceId), eq(schema.invoices.advanceType, "anzahlung")));
  // Normale Buchungen, aber Storno oder Korrektur mit Rückgewährregel: Zahlung, Rückzahlung und Festschreiben der
  // Korrektur ändern, wie viel Steuer bis zur Rückzahlung gehalten wird (advance-vat-plan.ts, „refund“). Abgezogene
  // Anzahlungen einer Schlussrechnung bleiben daneben betroffen.
  const refund =
    original.id && original.status === "final" && refundOnly(original as Invoice) && (invoice.kind !== "rechnung" || (await flaggedChain(tx, original.id)))
      ? [{ id: original.id }]
      : [];
  return [...referenced.map(({ invoice }) => invoice), ...refund];
}

async function flaggedChain(tx: Tx, originalId: string): Promise<boolean> {
  const rows = await tx.execute(sql`with recursive chain as (
    select id, reduction_rule from invoices where corrects_id = ${originalId} and status = 'final'
    union select i.id, i.reduction_rule from invoices i join chain c on i.corrects_id = c.id where i.status = 'final'
  ) select 1 from chain where reduction_rule is not null limit 1`);
  return [...rows].length > 0;
}

/** Vor dem ersten Audit-Schreibzugriff; Zahlungen und Schlussrechnung rechnen unter derselben Rechnungssperre. */
async function lockAdvanceVat(tx: Tx, invoiceId: string): Promise<void> {
  const originals = await affectedAdvances(tx, invoiceId);
  if (!originals.length) return;
  await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(
      inArray(
        schema.invoices.id,
        originals.map((i) => i.id),
      ),
    )
    .orderBy(asc(schema.invoices.id))
    .for("update");
}

/** Ein gemeinsamer Rechnungslader hält Anzahlungsoriginale vor allen weiteren Schreibzugriffen gesperrt. */
export async function lockInvoice(tx: Tx, id: string) {
  await lockAdvanceVat(tx, id);
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id)).for("update");
  return invoice;
}

/**
 * Persistenz von Zahlung, Ausbuchung und Festschreibung: dieselbe Nebenbuchrechnung vor und nach der Änderung.
 * Keine Rückrechnung aus Kontenrollen und keine zweite Formel. Die Rechnungssperre hält beide Stände zusammen;
 * bei einem Fehler rollen Quelldatensatz, normale Buchung und Steuerumbuchung gemeinsam zurück.
 */
export async function withAdvanceVatChange<T>(tx: Tx, invoiceId: string | null, work: () => Promise<T>): Promise<T> {
  if (!invoiceId) return work();
  await lockAdvanceVat(tx, invoiceId);
  const originals = await affectedAdvances(tx, invoiceId);
  const before = await Promise.all(originals.map((original) => loadAdvanceVatPlan(original, tx)));
  const result = await work();
  for (const [i, original] of originals.entries()) {
    const after = await loadAdvanceVatPlan(original, tx);
    if (after.unclear && !before[i]!.unclear) {
      throw new UserError(
        `Rechnung ${after.original.number}: Die Überzahlung am ${after.unclear} lässt sich nicht eindeutig den Steuersätzen zuordnen, deren Steuer bis zur Rückzahlung bestehen bleibt. Korrigiere anteilig über alle Steuersätze der Rechnung.`,
      );
    }
    const changes = advanceVatDifference(before[i]!.postingChanges, after.postingChanges);
    const balanceChanges = advanceBalanceDifference(before[i]!.balanceChanges, after.balanceChanges);
    if (!changes.length && !balanceChanges.length) continue;
    const books = await openBooks(tx);
    for (const { date, shares } of changes) {
      const lines = advanceUsesPayments(after.original.taxTreatment)
        ? invoicePaymentPosting(totalsFromTaxes(shares), 0, books.kontenrahmen, "ist", shares, after.original.taxTreatment)
        : advanceReportingPosting(shares, books.kontenrahmen, after.original.taxTreatment);
      if (!lines.length) continue;
      await post(tx, books, {
        date,
        description: after.kind === "refund" ? `Umsatzsteuer bis zur Rückzahlung ${after.original.number}` : `Umsatzsteuer Anzahlung ${after.original.number}`,
        sourceType: "invoice",
        sourceId: original.id,
        // Nur Steuerumbuchung, Bank/Kasse und Forderung bleiben in der normalen Zahlungsbuchung.
        lines,
      });
    }
    for (const { date, lines } of balanceChanges) {
      await post(tx, books, {
        date,
        description: `Bilanzierung Anzahlung ${after.original.number}`,
        sourceType: "invoice",
        sourceId: original.id,
        lines,
      });
    }
  }
  return result;
}
