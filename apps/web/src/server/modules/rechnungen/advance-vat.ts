import { ACCOUNTS, invoicePaymentPosting, totalsFromTaxes, type TaxShare, type Kontenrahmen } from "@haben/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { loadAdvanceVatPlan } from "./advance-vat-plan.ts";
import { managedAdvance } from "./invoice-vat.ts";

/** Betroffene Anzahlung oder die in einer Schlussrechnung abgezogenen neuen Anzahlungen. */
async function affectedAdvances(tx: Tx, invoiceId: string) {
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice) return [];
  const original = await managedAdvance(invoice, tx);
  if (original) return [original];
  const referenced = await tx
    .selectDistinct({ invoice: schema.invoices })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(and(eq(schema.invoiceLines.invoiceId, invoiceId), eq(schema.invoices.advanceType, "anzahlung")));
  const result = [];
  for (const { invoice: advance } of referenced) if (await managedAdvance(advance, tx)) result.push(advance);
  return result;
}

/** Vor dem ersten Audit-Schreibzugriff; Zahlungen und Schlussrechnung rechnen unter derselben Rechnungssperre. */
export async function lockAdvanceVat(tx: Tx, invoiceId: string): Promise<void> {
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

/** Bereits gebuchte Steueranteile je Datum, nur für diese neue Anzahlung; die ursprüngliche Rechnung enthält nicht fällige USt. */
async function bookedShares(tx: Tx, invoiceId: string): Promise<Map<string, TaxShare[]>> {
  const rows = await tx
    .select({
      date: schema.journalEntries.date,
      kr: schema.journalEntries.kontenrahmen,
      account: schema.journalLines.account,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      basis: schema.journalLines.basis,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalEntries.sourceType, "invoice"), eq(schema.journalEntries.sourceId, invoiceId)));
  const byDate = new Map<string, TaxShare[]>();
  for (const r of rows) {
    const a = ACCOUNTS[r.kr as Kontenrahmen];
    const rate = r.account === a.ust[1900] ? 1900 : r.account === a.ust[700] ? 700 : r.account === a.forderungen && r.basis !== null ? 0 : null;
    if (rate === null) continue;
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), { rate, base: r.basis ?? 0, tax: r.credit - r.debit }]);
  }
  return byDate;
}

/**
 * Ergänzt nur Differenzbuchungen, nie Änderungen an bestehenden Buchungen. Eine spät zugeordnete frühere Zahlung
 * erhält ihren Steueranteil am Zahlungstag; derselbe Anteil wird am Tag der Schlussleistung zurückgenommen.
 * Die vorhandenen Konten „Umsatzsteuer nicht fällig“ und die Umbuchung mit gespeicherter Bemessungsgrundlage werden
 * wie bei Ist verwendet. Bank, Forderung und EÜR-Zufluss bleiben in der ursprünglichen Zahlungsbuchung.
 */
export async function syncAdvanceVat(tx: Tx, invoiceId: string): Promise<void> {
  for (const original of await affectedAdvances(tx, invoiceId)) {
    const { changes } = await loadAdvanceVatPlan(original, tx);
    const booked = await bookedShares(tx, original.id);
    const wanted = new Map(changes.map((c) => [c.date, c.shares]));
    const books = await openBooks(tx);
    for (const date of [...new Set([...wanted.keys(), ...booked.keys()])].sort()) {
      const target = wanted.get(date) ?? [];
      const previous = booked.get(date) ?? [];
      const rates = [...new Set([...target, ...previous].map((s) => s.rate))];
      const sum = (rows: TaxShare[], rate: number, key: "base" | "tax") => rows.filter((s) => s.rate === rate).reduce((n, s) => n + s[key], 0);
      const shares = rates
        .map((rate) => ({ rate, base: sum(target, rate, "base") - sum(previous, rate, "base"), tax: sum(target, rate, "tax") - sum(previous, rate, "tax") }))
        .filter((s) => s.base || s.tax);
      if (!shares.length) continue;
      await post(tx, books, {
        date,
        description: `Umsatzsteuer Anzahlung ${original.number}`,
        sourceType: "invoice",
        sourceId: original.id,
        // 0 € Zahlung: nur Steuerumbuchung und Bemessungsgrundlage, keine zweite Bank- oder Kassenbewegung.
        lines: invoicePaymentPosting(totalsFromTaxes(shares), 0, books.kontenrahmen, "ist", shares, original.taxTreatment),
      });
    }
  }
}
