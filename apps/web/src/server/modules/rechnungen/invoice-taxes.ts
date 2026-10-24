import { foreignToEuro, totalsFromTaxes, type InvoiceTotals, type TaxBreakdown } from "@haben/core";
import { eq, inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Netto und Umsatzsteuer je Steuersatz werden einmal beim Speichern einer Rechnung berechnet
 * (computeInvoice) und in invoice_taxes abgelegt. Voranmeldung, Zahlungsbuchung, Auswertungen,
 * Schlussrechnung, PDF und XML lesen nur diese Werte, statt aus den Positionen neu zu rechnen.
 *
 * Bei Fremdwährung stehen in base/tax die Euro-Beträge (umgerechnet mit dem Kurs der Rechnung, für Buchung und
 * Auswertungen) und in original_base/original_tax die Beträge in der Währung der Rechnung (für PDF und XML).
 */

/**
 * Steuerzeilen in Euro: bei Fremdwährung je Satz umgerechnet (Bemessungsgrundlage und Steuer einzeln, wie die Steuer
 * in Euro auf der Rechnung steht); ohne Kurs 0, die Rechnung lässt sich dann noch nicht festschreiben.
 */
export function euroTaxes(taxes: TaxBreakdown[], currency: string, rate: string | null): (TaxBreakdown & { originalBase: number | null; originalTax: number | null })[] {
  if (currency === "EUR") return taxes.map((t) => ({ ...t, originalBase: null, originalTax: null }));
  return taxes.map((t) => ({
    rate: t.rate,
    base: rate ? foreignToEuro(t.base, rate) : 0,
    tax: rate ? foreignToEuro(t.tax, rate) : 0,
    originalBase: t.base,
    originalTax: t.tax,
  }));
}

/** Steuerzeilen einer Rechnung ersetzen; nur für Entwürfe, festgeschriebene sperrt ein Trigger */
export async function storeInvoiceTaxes(
  tx: Tx,
  invoiceId: string,
  taxes: (TaxBreakdown & { originalBase?: number | null; originalTax?: number | null })[],
): Promise<void> {
  await tx.delete(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.invoiceId, invoiceId));
  if (taxes.length > 0) {
    await tx.insert(schema.invoiceTaxes).values(
      taxes.map((t) => ({ invoiceId, rate: t.rate, base: t.base, tax: t.tax, originalBase: t.originalBase ?? null, originalTax: t.originalTax ?? null })),
    );
  }
}

/** Gespeicherte Summen je Rechnung in Euro; Rechnungen ohne Positionen haben leere Summen */
export async function invoiceTotalsById(ids: string[], q: Db | Tx = db): Promise<Map<string, InvoiceTotals>> {
  if (ids.length === 0) return new Map();
  const rows = await q.select().from(schema.invoiceTaxes).where(inArray(schema.invoiceTaxes.invoiceId, ids));
  return new Map(ids.map((id) => [id, totalsFromTaxes(rows.filter((r) => r.invoiceId === id))]));
}

/** Summen in der Währung der Rechnung, wie auf PDF und XML; bei Euro dieselben wie invoiceTotalsById */
export async function invoiceDocumentTotals(id: string, q: Db | Tx = db): Promise<InvoiceTotals> {
  const rows = await q.select().from(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.invoiceId, id));
  return totalsFromTaxes(rows.map((r) => (r.originalBase === null ? r : { rate: r.rate, base: r.originalBase, tax: r.originalTax ?? 0 })));
}
