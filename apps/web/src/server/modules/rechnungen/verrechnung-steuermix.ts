import { ohneSteueranteile, paidTaxShares, type InvoiceTotals } from "@haben/core";
import { asc, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";

/**
 * Stände des Steuermix einer Rechnung, Zeile für Zeile ihrer Verrechnungen in der Reihenfolge, in der sie entstanden sind:
 * vorn der aktuelle Rest, danach jeder frühere Stand. Eine Verrechnung nimmt das Entgelt der Gegenrechnung weg, also deren
 * Steueranteile; die Gegenzeile einer Aufhebung gibt es zurück (netto je Gegenrechnung). Die früheren Stände braucht
 * recordedTaxShares: Ein Anteil, der zum Rest vor einer Aufhebung gebucht wurde, gilt weiter (§ 17 Abs. 1 Satz 8 UStG).
 */
export function mixeNachVerrechnungen(
  totals: InvoiceTotals,
  zeilen: readonly { counterInvoiceId: string; amount: number }[],
  gegen: Map<string, InvoiceTotals>,
): InvoiceTotals[] {
  const netto = new Map<string, number>();
  const staende: InvoiceTotals[] = [];
  for (const z of zeilen) {
    netto.set(z.counterInvoiceId, (netto.get(z.counterInvoiceId) ?? 0) + z.amount);
    const weg = [...netto].filter(([, betrag]) => betrag > 0).flatMap(([id, betrag]) => paidTaxShares(gegen.get(id) ?? totals, betrag));
    staende.push(weg.length > 0 ? ohneSteueranteile(totals, weg) : totals);
  }
  return staende.length > 0 ? [staende.at(-1)!, ...staende.slice(0, -1)] : [totals];
}

/**
 * Steuermix je Rechnung nach Verrechnungen (mixeNachVerrechnungen): Nur der Rest ist vereinnahmbar, und nur darüber
 * verteilen sich die Zahlungen — sonst trüge bei zwei Steuersätzen der zurückgenommene Satz die Steuer mit (Befunde 2 und 3
 * im Review zu #877). Rechnungen ohne Verrechnung fehlen in der Map, für sie gilt ihr voller Mix.
 *
 * Die eine Stelle dafür: Voranmeldung (vat-figures.ts), EÜR (reports.ts) und Bankabgleich (bank.ts) lesen dieselben
 * Stände, damit alle dieselbe Zahlung gleich aufteilen.
 */
export async function mixNachVerrechnungen(totals: Map<string, InvoiceTotals>, q: Db | Tx): Promise<Map<string, InvoiceTotals[]>> {
  const ids = [...totals.keys()];
  if (ids.length === 0) return new Map();
  const s = schema.invoiceSettlements;
  const rows = await q
    .select({ invoiceId: s.invoiceId, counterInvoiceId: s.counterInvoiceId, amount: s.amount })
    .from(s)
    .where(inArray(s.invoiceId, ids))
    .orderBy(asc(s.createdAt), asc(s.id));
  if (rows.length === 0) return new Map();
  const gegen = await invoiceTotalsById([...new Set(rows.map((r) => r.counterInvoiceId))], q);
  const out = new Map<string, InvoiceTotals[]>();
  for (const id of ids) {
    const eigene = rows.filter((r) => r.invoiceId === id);
    if (eigene.length > 0) out.set(id, mixeNachVerrechnungen(totals.get(id)!, eigene, gegen));
  }
  return out;
}
