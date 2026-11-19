// Erledigte Beträge und Steueranteile von Zahlungen und Ausbuchungen auf Rechnungen und Belege

import { recordedTaxShares, settlementTaxShares, type InvoiceTotals, type TaxShare } from "@haben/core";
import { sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById, mixeNachVerrechnungen, invoicePaymentGroup, paidByTarget } from "../rechnungen/index.ts";

/** Erledigter Betrag einer Rechnung bzw. eines Belegs innerhalb einer Transaktion (nach dem Sperren) */
export async function settledOn(tx: Tx, column: "invoice_id" | "document_id", id: string): Promise<number> {
  const ids = column === "invoice_id" ? await invoicePaymentGroup(id, tx) : [id];
  const paid = await paidByTarget(column, ids, tx);
  return ids.reduce((sum, target) => sum + (paid.get(target) ?? 0), 0);
}

/**
 * Steueranteil einer weiteren Zahlung bzw. Ausbuchung auf eine Rechnung, gegen das schon Erfasste (settlementTaxShares):
 * Alle zusammen ergeben so genau die Steuer der Rechnung. Ältere Zeilen ohne gespeicherten Anteil zählen, wie gebucht,
 * mit dem aus ihrem Betrag gerechneten. Erst nach dem Sperren der Rechnung aufrufen.
 */
export async function invoiceTaxShares(tx: Tx, invoiceId: string, totals: InvoiceTotals, amount: number): Promise<TaxShare[]> {
  const ids = await invoicePaymentGroup(invoiceId, tx);
  const rows = await tx.execute<{ invoice_id: string; amount: number; tax_shares: TaxShare[] | null; tax_shares_invoice_id: string | null }>(
    sql`select invoice_id, amount, tax_shares, tax_shares_invoice_id from allocations where invoice_id in ${ids}
        union all select invoice_id, amount, tax_shares, tax_shares_invoice_id from write_offs where invoice_id in ${ids}
        union all select invoice_id, amount, tax_shares, tax_shares_invoice_id from cash_entries where invoice_id in ${ids}`,
  );
  const settled = [...rows].reduce((sum, r) => sum + Number(r.amount), 0);
  // Verrechnungen mindern das Entgelt um den Anteil der Gegenrechnung. Die Zahlungen verteilen sich danach über den Rest,
  // nicht über den vollen Mix: Bei zwei Steuersätzen trüge sonst der zurückgenommene Satz die Steuer mit (#877, Befund 2).
  const verrechnet = [
    ...(await tx.execute<{ counter_invoice_id: string; amount: number }>(
      // In der Reihenfolge, in der sie entstanden sind: Die Gegenzeile einer Aufhebung gibt das Entgelt wieder zurück
      sql`select counter_invoice_id, amount from invoice_settlements where invoice_id in ${ids} order by created_at, id`,
    )),
  ].map((r) => ({ counterInvoiceId: r.counter_invoice_id, amount: Number(r.amount) }));
  const gegen = verrechnet.length > 0 ? await invoiceTotalsById([...new Set(verrechnet.map((r) => r.counterInvoiceId))], tx) : new Map<string, InvoiceTotals>();
  const mixe = mixeNachVerrechnungen(totals, verrechnet, gegen);
  const rest = mixe[0]!;
  // Wie Voranmeldung und EÜR (recordedTaxShares): ein Anteil zählt nur für die Rechnung, für die er gerechnet ist
  const recorded = [...rows].flatMap((r) => recordedTaxShares(totals, Number(r.amount), r.tax_shares_invoice_id === r.invoice_id ? r.tax_shares : null, mixe));
  return settlementTaxShares(rest, settled, recorded, amount);
}

/** Gespeicherter Steueranteil einer Gegenzeile: genau umgekehrt */
export const negatedShares = (shares: TaxShare[] | null) => shares?.map((s) => ({ rate: s.rate, base: -s.base, tax: -s.tax })) ?? null;

/** Erledigter Betrag je Beleg (Zuordnungen und Ausbuchungen), Vorzeichen wie auf dem Konto */
export async function documentPayments(ids: string[], q: Db | Tx = db) {
  return paidByTarget("document_id", ids, q);
}
