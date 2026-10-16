import { totalsFromTaxes, type InvoiceTotals, type TaxBreakdown } from "@haben/core";
import { eq, inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "./db/index.ts";

/**
 * Netto und Umsatzsteuer je Steuersatz werden einmal beim Speichern einer Rechnung berechnet
 * (computeInvoice) und in invoice_taxes abgelegt. Voranmeldung, Zahlungsbuchung, Auswertungen,
 * Schlussrechnung, PDF und XML lesen nur diese Werte, statt aus den Positionen neu zu rechnen.
 */

/** Steuerzeilen einer Rechnung ersetzen; nur für Entwürfe, festgeschriebene sperrt ein Trigger */
export async function storeInvoiceTaxes(tx: Tx, invoiceId: string, taxes: TaxBreakdown[]): Promise<void> {
  await tx.delete(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.invoiceId, invoiceId));
  if (taxes.length > 0) {
    await tx.insert(schema.invoiceTaxes).values(taxes.map((t) => ({ invoiceId, rate: t.rate, base: t.base, tax: t.tax })));
  }
}

/** Gespeicherte Summen je Rechnung; Rechnungen ohne Positionen haben leere Summen */
export async function invoiceTotalsById(ids: string[], q: Db | Tx = db): Promise<Map<string, InvoiceTotals>> {
  if (ids.length === 0) return new Map();
  const rows = await q.select().from(schema.invoiceTaxes).where(inArray(schema.invoiceTaxes.invoiceId, ids));
  return new Map(ids.map((id) => [id, totalsFromTaxes(rows.filter((r) => r.invoiceId === id))]));
}
