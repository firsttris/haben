import { ohneSteueranteile, paidTaxShares, type InvoiceTotals } from "@haben/core";
import { inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";

/**
 * Steuermix je Rechnung nach Verrechnungen: Eine Verrechnung nimmt das Entgelt der Gegenrechnung weg, also deren
 * Steueranteile. Nur der Rest ist vereinnahmbar, und nur darüber verteilen sich die Zahlungen — sonst trüge bei zwei
 * Steuersätzen der zurückgenommene Satz die Steuer mit (Befunde 2 und 3 im Review zu #877). Rechnungen ohne Verrechnung
 * fehlen in der Map, für sie gilt ihr voller Mix.
 *
 * Die eine Stelle dafür: Voranmeldung (vat-figures.ts) und EÜR (reports.ts) lesen denselben Rest, damit beide dieselbe
 * Zahlung gleich aufteilen.
 */
export async function mixNachVerrechnungen(totals: Map<string, InvoiceTotals>, q: Db | Tx): Promise<Map<string, InvoiceTotals>> {
  const ids = [...totals.keys()];
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({
      invoiceId: schema.invoiceSettlements.invoiceId,
      counterInvoiceId: schema.invoiceSettlements.counterInvoiceId,
      amount: schema.invoiceSettlements.amount,
    })
    .from(schema.invoiceSettlements)
    .where(inArray(schema.invoiceSettlements.invoiceId, ids));
  // Netto je Rechnung und Gegenrechnung: Die Gegenzeile einer Aufhebung gibt das Entgelt wieder zurück
  const netto = new Map<string, { invoiceId: string; counterInvoiceId: string; amount: number }>();
  for (const r of rows) {
    const key = `${r.invoiceId}|${r.counterInvoiceId}`;
    netto.set(key, { ...r, amount: (netto.get(key)?.amount ?? 0) + r.amount });
  }
  const positiv = [...netto.values()].filter((r) => r.amount > 0);
  if (positiv.length === 0) return new Map();
  const gegen = await invoiceTotalsById([...new Set(positiv.map((r) => r.counterInvoiceId))], q);
  const out = new Map<string, InvoiceTotals>();
  for (const id of ids) {
    const weg = positiv.filter((r) => r.invoiceId === id).flatMap((r) => paidTaxShares(gegen.get(r.counterInvoiceId) ?? totals.get(id)!, r.amount));
    if (weg.length > 0) out.set(id, ohneSteueranteile(totals.get(id)!, weg));
  }
  return out;
}
