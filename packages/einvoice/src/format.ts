import type { InvoiceDocument, InvoiceKind } from "./types.ts";

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

export const TITLES: Record<InvoiceKind, string> = {
  rechnung: "Rechnung",
  storno: "Stornorechnung",
  korrektur: "Rechnungskorrektur",
};

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

export function paymentSentence(doc: InvoiceDocument): string {
  if (doc.totals.gross < 0) return "Der Betrag wird Ihnen erstattet.";
  if (doc.totals.gross === 0) return "Es ist keine Zahlung erforderlich.";
  return `Bitte überweisen Sie den Betrag bis zum ${formatDate(doc.dueDate)} unter Angabe der Rechnungsnummer.`;
}

export function countryName(code: string): string {
  return new Intl.DisplayNames(["de"], { type: "region" }).of(code.toUpperCase()) ?? code;
}
