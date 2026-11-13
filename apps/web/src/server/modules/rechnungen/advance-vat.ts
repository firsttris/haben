import { advanceBalanceDifference, advanceVatDifference, invoicePaymentPosting, totalsFromTaxes } from "@haben/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { loadAdvanceVatPlan } from "./advance-vat-plan.ts";
import { invoiceTaxReader } from "./invoice-tax.ts";

/** Betroffene Anzahlung oder die in einer Schlussrechnung abgezogenen neuen Anzahlungen. */
async function affectedAdvances(tx: Tx, invoiceId: string) {
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice) return [];
  const original = await invoiceTaxReader(tx).original(invoice);
  // KU hat keine Anzahlungs-USt, benötigt bei GmbH/UG aber denselben Bilanzierungsanschluss.
  if (original.advanceType === "anzahlung") return [original as typeof schema.invoices.$inferSelect];
  const referenced = await tx
    .selectDistinct({ invoice: schema.invoices })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(and(eq(schema.invoiceLines.invoiceId, invoiceId), eq(schema.invoices.advanceType, "anzahlung")));
  return referenced.map(({ invoice }) => invoice);
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
    const changes = advanceVatDifference(before[i]!.changes, after.changes);
    const balanceChanges = advanceBalanceDifference(before[i]!.balanceChanges, after.balanceChanges);
    if (!changes.length && !balanceChanges.length) continue;
    const books = await openBooks(tx);
    for (const { date, shares } of changes) {
      await post(tx, books, {
        date,
        description: `Umsatzsteuer Anzahlung ${original.number}`,
        sourceType: "invoice",
        sourceId: original.id,
        // Nur Steuerumbuchung, Bank/Kasse und Forderung bleiben in der normalen Zahlungsbuchung.
        lines: invoicePaymentPosting(totalsFromTaxes(shares), 0, books.kontenrahmen, "ist", shares, original.taxTreatment),
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
