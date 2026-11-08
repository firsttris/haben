import { skontoFristen, type SkontoFrist } from "@haben/core";
import { TEXTS, type Texts } from "./i18n.ts";
import type { InvoiceDocument, OrderReferences, Seller } from "./types.ts";

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

const REFERENCE_KEYS = ["buyerOrder", "sellerOrder", "despatchAdvice"] as const;

/**
 * Nur die gesetzten Referenzen, getrimmt und ohne Steuerzeichen; Leerzeichen allein zählen als keine. Steuerzeichen (etwa
 * aus einer kopierten Bestellnummer) verbietet XML 1.0 (Production [2] Char), und keine Schrift kann sie im PDF/A setzen.
 */
export function presentReferences(references: OrderReferences | undefined): OrderReferences {
  const present: OrderReferences = {};
  for (const key of REFERENCE_KEYS) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
    const value = references?.[key]?.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (value) present[key] = value;
  }
  return present;
}

/** Zeilen für den Kopfblock im PDF: „Ihre Bestellung 4500012345“ usw., in der Reihenfolge Bestellung, Auftrag, Lieferschein */
export function referenceMeta(references: OrderReferences | undefined, t: Pick<Texts, "orderReferences">): { label: string; value: string }[] {
  const present = presentReferences(references);
  return REFERENCE_KEYS.flatMap((key) => (present[key] ? [{ label: t.orderReferences[key], value: present[key] }] : []));
}
