import { skontoFristen, type SkontoFrist } from "@haben/core";
import { TEXTS, type Texts } from "./i18n.ts";
import type { InvoiceDocument, Seller } from "./types.ts";

/** "2026-10-02" → "02.10.2026" */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/** IBAN in Vierergruppen: "DE89 3704 0044 0532 0130 00" */
export function formatIban(iban: string): string {
  return compactIban(iban)
    .replace(/(.{4})/g, "$1 ")
    .trim();
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

type PaymentFields = Pick<InvoiceDocument, "kind" | "totals" | "issueDate" | "dueDate" | "skonto">;

/** Skontostufen mit Frist und Betrag; nur auf Rechnungen mit Zahlbetrag, nicht auf Storno und Korrektur */
export function invoiceSkonto(doc: PaymentFields): SkontoFrist[] {
  return doc.kind === "rechnung" && doc.skonto ? skontoFristen(doc.skonto, doc.issueDate, doc.totals.gross) : [];
}

/** Zahlungssatz unter der Summe, mit Skonto je Stufe; das XML bleibt wie BT-20 und BT-120 deutsch (siehe i18n.ts) */
export function paymentSentence(doc: PaymentFields, t: Texts = TEXTS.de): string {
  if (doc.totals.gross < 0) return t.refund;
  if (doc.totals.gross === 0) return t.noPayment;
  const skonto = invoiceSkonto(doc).map((s) => t.skonto(t.percent(s.percent), t.date(s.until), t.money(s.amount), t.money(s.payable)));
  return [t.payBy(t.date(doc.dueDate)), ...skonto].join(" ");
}

export function countryName(code: string, locale = "de"): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
}

/** Name für GiroCode und Zahlungskonto (BT-85): der Kontoinhaber, sonst der Firmenname */
export function accountHolder(seller: Pick<Seller, "name" | "kontoinhaber">): string {
  return seller.kontoinhaber?.trim() || seller.name;
}
