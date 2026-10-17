import type { Cents } from "./money.ts";

/*
 * Lebenszyklen von Rechnung, Angebot und Voranmeldung und die Regel „offener Betrag“ als reine Funktionen (#81).
 * Die Datenbank liefert nur Fakten (Status, Summen, Zahlungen, ob storniert), entschieden wird hier. So rechnen
 * Rechnungsliste, Bankabgleich, offene Posten und die Sperre der Firmendaten garantiert gleich.
 */

// Rechnungen --------------------------------------------------------------------------------------------------

export type InvoiceStatus = "draft" | "final";
export type InvoiceKind = "rechnung" | "storno" | "korrektur";

export type InvoiceListStatus = "entwurf" | "offen" | "teilbezahlt" | "bezahlt" | "ueberfaellig" | "storniert" | "storno" | "korrektur";

export interface InvoiceFacts {
  status: InvoiceStatus;
  kind: InvoiceKind;
  /** Brutto; Storno und Korrektur negativ */
  gross: Cents;
  /** Summe der Zuordnungen auf diese Rechnung, Vorzeichen wie auf dem Konto */
  paid: Cents;
  /** Es gibt ein festgeschriebenes Storno zu dieser Rechnung */
  cancelled: boolean;
  /** Nur beim Storno: was auf die stornierte Rechnung gezahlt wurde */
  paidOnOriginal?: Cents;
}

/**
 * Offen bei einer Stornorechnung: Rechnung und Storno heben sich auf, übrig bleibt, was auf die Rechnung
 * schon gezahlt und noch nicht erstattet wurde (negativ, also eine Auszahlung).
 */
export function stornoOpen(paidOnOriginal: Cents, paidOnStorno: Cents): Cents {
  return 0 - paidOnOriginal - paidOnStorno;
}

/**
 * Offener Betrag einer Rechnung, Vorzeichen wie die Rechnung: positiv = der Kunde schuldet noch, negativ = zu erstatten
 * (Korrektur, Storno einer bezahlten Rechnung). Entwürfe und stornierte Rechnungen sind nie offen.
 */
export function invoiceOpen(i: InvoiceFacts): Cents {
  if (i.status !== "final" || i.cancelled) return 0;
  if (i.kind === "storno") return stornoOpen(i.paidOnOriginal ?? 0, i.paid);
  return i.gross - i.paid;
}

/** Status für die Rechnungsliste */
export function invoiceListStatus(i: InvoiceFacts & { dueDate: string }, today: string): InvoiceListStatus {
  if (i.status === "draft") return "entwurf";
  if (i.kind === "storno") return "storno";
  if (i.cancelled) return "storniert";
  if (i.kind === "korrektur") return "korrektur";
  const open = invoiceOpen(i);
  if (open === 0) return "bezahlt";
  if (i.dueDate < today) return "ueberfaellig";
  if (i.paid !== 0) return "teilbezahlt";
  return "offen";
}

/** Was gegen das Ändern oder Löschen spricht; null = Entwurf, frei */
export function invoiceEditProblem(i: Pick<InvoiceFacts, "status">): string | null {
  return i.status === "draft" ? null : "Die Rechnung ist festgeschrieben und kann nicht mehr geändert werden.";
}

/** Was gegen Storno oder Korrektur einer Rechnung spricht; null = in Ordnung */
export function cancellationProblem(
  original: Pick<InvoiceFacts, "status" | "kind"> & { number: string | null },
  facts: { cancelled: boolean; deductedIn: string | null },
): string | null {
  if (original.status !== "final" || original.kind !== "rechnung") return "Nur festgeschriebene Rechnungen können storniert oder korrigiert werden";
  if (facts.cancelled) return `Die Rechnung ${original.number} ist bereits storniert`;
  if (facts.deductedIn) return `Die Abschlagsrechnung ist in Schlussrechnung ${facts.deductedIn} abgezogen. Storniere zuerst die Schlussrechnung`;
  return null;
}

// Belege -------------------------------------------------------------------------------------------------------

/**
 * Offener Betrag eines über die Bank zu zahlenden Belegs, Vorzeichen wie auf dem Konto: Eine Ausgabe ist negativ,
 * eine Gutschrift positiv. `paid` ist die Summe der Zuordnungen (Ausgang negativ).
 */
export function documentOpen(gross: Cents, paid: Cents): Cents {
  return 0 - gross - paid;
}

// Angebote -----------------------------------------------------------------------------------------------------

export type QuoteStatus = "draft" | "final";
export type QuoteDecision = "angenommen" | "abgelehnt";
export type QuoteListStatus = "entwurf" | "offen" | "abgelaufen" | "angenommen" | "abgelehnt" | "abgerechnet";

export interface QuoteFacts {
  status: QuoteStatus;
  decision: QuoteDecision | null;
  /** Rechnung, die aus dem Angebot entstanden ist */
  invoiceId: string | null;
  validUntil: string;
}

export function quoteStatus(q: QuoteFacts, today: string): QuoteListStatus {
  if (q.status === "draft") return "entwurf";
  if (q.invoiceId) return "abgerechnet";
  if (q.decision) return q.decision;
  return q.validUntil < today ? "abgelaufen" : "offen";
}

export function quoteEditProblem(q: Pick<QuoteFacts, "status">): string | null {
  return q.status === "draft" ? null : "Das Angebot ist festgeschrieben und kann nicht mehr geändert werden.";
}

/** Antwort des Kunden festhalten oder zurücknehmen: nur festgeschrieben und solange keine Rechnung daraus entstanden ist */
export function quoteDecisionProblem(q: Pick<QuoteFacts, "status" | "invoiceId">): string | null {
  if (q.status !== "final") return "Das Angebot ist noch ein Entwurf.";
  if (q.invoiceId) return "Aus dem Angebot ist bereits eine Rechnung entstanden.";
  return null;
}

/** Rechnung aus dem Angebot: festgeschrieben, noch nicht abgerechnet, nicht abgelehnt */
export function quoteInvoiceProblem(q: Pick<QuoteFacts, "status" | "invoiceId" | "decision">): string | null {
  if (q.status !== "final") return "Nur festgeschriebene Angebote lassen sich abrechnen.";
  if (q.invoiceId) return "Aus dem Angebot ist bereits eine Rechnung entstanden.";
  if (q.decision === "abgelehnt") return "Das Angebot ist als abgelehnt markiert.";
  return null;
}

// Voranmeldungen -----------------------------------------------------------------------------------------------

export type VatReturnStatus = "draft" | "sent";

/** Prüfen oder Senden: nur ein Entwurf */
export function vatReturnSendProblem(v: { status: VatReturnStatus }): string | null {
  return v.status === "draft" ? null : "Diese Anmeldung ist bereits gesendet.";
}

/** Berichtigen: nur eine gesendete Anmeldung */
export function vatReturnCorrectionProblem(latestSent: { status: VatReturnStatus } | null | undefined): string | null {
  return latestSent?.status === "sent" ? null : "Es gibt keine gesendete Anmeldung, die berichtigt werden könnte.";
}
