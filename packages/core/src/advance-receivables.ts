import type { Cents } from "./money.ts";

/** Nur festgeschriebene Belege mit dem neuen Bilanzverfahrensmarker; Altbelege liefert der Aufrufer nicht hierher. */
export interface DeferredInvoice {
  id: string;
  correctsId: string | null;
  replacesInvoiceId: string | null;
  kind: "rechnung" | "korrektur" | "storno";
  variant: "abschlag" | "schluss" | null;
  advanceType: "anzahlung" | "teilleistung" | null;
  number: string;
  party: string;
  issueDate: string;
  dueDate: string;
  performanceDate: string;
  gross: Cents;
}

export interface DeferredSettlement {
  invoiceId: string;
  date: string;
  amount: Cents;
  /** Gespeicherter Nettoanteil; nicht aus einem Steuersatz neu runden. */
  net: Cents;
  kind: "payment" | "writeOff";
}

export interface DeferredDeduction {
  invoiceId: string;
  advanceId: string;
}

export interface AdvanceReceivablePosition {
  id: string;
  originId: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  gross: Cents;
  open: Cents;
  kind: "request" | "receivable" | "unbilled" | "refund";
}

export interface AdvanceReceivables {
  positions: AdvanceReceivablePosition[];
  /** Herkunftsumfang des gesonderten Journalabgleichs, keine Vereinigung nach Betrag oder Kundenname. */
  invoiceIds: string[];
  receivables: Cents;
  requests: Cents;
  unbilled: Cents;
  netAdvances: Cents;
}

/** Stichtagsstand aus Belegen und datierten Erledigungen; Rechnungsaustausch nimmt keine erbrachte Leistung zurück. */
export function advanceReceivables(
  _invoices: readonly DeferredInvoice[],
  _settlements: readonly DeferredSettlement[],
  _deductions: readonly DeferredDeduction[],
  _cutoff: string,
): AdvanceReceivables {
  return { positions: [], invoiceIds: [], receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 };
}
