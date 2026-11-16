import { recordedTaxShares, settlementTaxShares, type InvoiceTotals, type TaxShare } from "@haben/core";
import type { TurnoverItem } from "@haben/core";

export interface ReceiptPayment {
  source: "bank" | "cash";
  id: string;
  invoiceId: string | null;
  amount: number;
  date: string;
  createdAt: Date;
  reversesId: string | null;
  taxShares: TaxShare[] | null;
  taxSharesInvoiceId: string | null;
}

type PaymentBasis = Pick<TurnoverItem, "net" | "basisSource">;
type RecordedPayment = { payment: ReceiptPayment; shares: TaxShare[]; basisSource: TurnoverItem["basisSource"] };

function receiptShares(payment: ReceiptPayment, totals: InvoiceTotals, settled: number, recorded: TaxShare[], previous: RecordedPayment | undefined) {
  if (previous && previous.payment.invoiceId === payment.invoiceId && previous.payment.amount === -payment.amount) {
    return { shares: previous.shares.map((row) => ({ rate: row.rate, base: -row.base, tax: -row.tax })), basisSource: previous.basisSource };
  }
  const stored = payment.taxSharesInvoiceId === payment.invoiceId ? payment.taxShares : null;
  const checked = recordedTaxShares(totals, payment.amount, stored);
  return checked === stored
    ? { shares: checked, basisSource: "stored" as const }
    : { shares: settlementTaxShares(totals, settled, recorded, payment.amount), basisSource: "derived" as const };
}

/** Gespeicherte Anteile bleiben maßgeblich. Fehlen sie, wird nur der Zahlungsanteil aus den unveränderten Steuerzeilen
 * abgeleitet, kumulativ auch über den Jahreswechsel und Bank/Kasse hinweg. Ausbuchungen werden kein Zahlungseingang. */
export function paymentBases(payments: ReceiptPayment[], totals: Map<string, InvoiceTotals>): Map<string, PaymentBasis> {
  const result = new Map<string, PaymentBasis>();
  const states = new Map<string, { settled: number; recorded: TaxShare[] }>();
  const previous = new Map<string, RecordedPayment>();
  const ordered = [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  for (const payment of ordered) {
    const key = `${payment.source}:${payment.id}`;
    const value = payment.invoiceId ? totals.get(payment.invoiceId) : undefined;
    if (!value || !payment.invoiceId || value.gross === 0 || !value.taxes.length) {
      result.set(key, { net: null, basisSource: "unknown" });
      continue;
    }
    const state = states.get(payment.invoiceId) ?? { settled: 0, recorded: [] };
    const reverse = payment.reversesId ? previous.get(`${payment.source}:${payment.reversesId}`) : undefined;
    const current = receiptShares(payment, value, state.settled, state.recorded, reverse);
    previous.set(key, { ...current, payment });
    state.settled += payment.amount;
    state.recorded.push(...current.shares);
    states.set(payment.invoiceId, state);
    result.set(key, { net: current.shares.reduce((sum, row) => sum + row.base, 0), basisSource: current.basisSource });
  }
  return result;
}
