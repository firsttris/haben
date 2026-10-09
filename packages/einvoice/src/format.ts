import { TEXTS, type Texts } from "./i18n.ts";
import type { InvoiceDocument } from "./types.ts";

/** "2026-10-02" → "02.10.2026" */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/** IBAN in Vierergruppen: "DE89 3704 0044 0532 0130 00" */
export function formatIban(iban: string): string {
  return compactIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

export function compactIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

/** Gutschriftartige Belege (Storno, Korrektur) gehen als Typ 381 mit positiven Beträgen ins XML. */
export function isCreditNote(doc: Pick<InvoiceDocument, "kind">): boolean {
  return doc.kind !== "rechnung";
}

/** Leistungszeitraum oder -datum; ohne Angabe gilt das Rechnungsdatum. */
export function servicePeriod(doc: InvoiceDocument): { from: string; to: string } {
  const from = doc.serviceFrom ?? doc.serviceTo ?? doc.issueDate;
  const to = doc.serviceTo ?? from;
  return { from, to };
}

/** Zahlungssatz unter der Summe; das XML bleibt wie BT-20 und BT-120 deutsch (siehe i18n.ts) */
export function paymentSentence(doc: Pick<InvoiceDocument, "totals" | "dueDate">, t: Texts = TEXTS.de): string {
  if (doc.totals.gross < 0) return t.refund;
  if (doc.totals.gross === 0) return t.noPayment;
  return t.payBy(t.date(doc.dueDate));
}

export function countryName(code: string, locale = "de"): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
}
