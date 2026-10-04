import { formatEuro, formatQuantity, formatRate, treatmentNote, type Cents, type Millis, type TaxTreatment, type UnitLabel } from "@haben/core";
import type { InvoiceKind } from "./types.ts";

/** Sprache der Belege für den Kunden; XML und Buchhaltung bleiben unverändert */
export type Language = "de" | "en";

export const LANGUAGES: Record<Language, string> = { de: "Deutsch", en: "Englisch" };

const EN_UNITS: Record<UnitLabel, [string, string]> = {
  "Std.": ["hr", "hrs"],
  Tag: ["day", "days"],
  Monat: ["month", "months"],
  "Stk.": ["pc", "pcs"],
  "Psch.": ["flat rate", "flat rate"],
  km: ["km", "km"],
};

const EN_NOTES: Record<Exclude<TaxTreatment, "regulaer">, string> = {
  reverse_charge: "Reverse charge: VAT liability of the recipient (Art. 196 VAT Directive).",
  drittland: "Not taxable in Germany (place of supply outside the EU).",
  steuerfrei: "VAT exempt under § 4 UStG.",
  kleinunternehmer: "No VAT is charged under § 19 UStG (small business).",
};

const isoParts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

/** Texte und Formate je Sprache; alles, was der Kunde auf dem PDF liest */
export const TEXTS = {
  de: {
    titles: { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur", angebot: "Angebot" } as Record<InvoiceKind | "angebot", string>,
    variants: { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" },
    confirmation: "Auftragsbestätigung",
    deliveryNote: "Lieferschein",
    date_: "Datum",
    quoteRef: "Zu Angebot",
    invoiceRef: "Zu Rechnung",
    deliveryDate: "Lieferdatum",
    orderTotal: "Auftragssumme",
    confirmationText: "Vielen Dank für Ihren Auftrag. Wir bestätigen ihn mit den oben genannten Positionen und Preisen.",
    received: "Leistung vollständig und ordnungsgemäß erhalten:",
    signature: "Datum, Unterschrift",
    deduction: (number: string, date: string, net: string, tax: string | null) =>
      `Abzüglich Abschlagsrechnung ${number} vom ${date} (netto ${net}${tax ? `, USt ${tax}` : ""})`,
    invoiceNumber: "Rechnungsnummer",
    invoiceDate: "Rechnungsdatum",
    quoteNumber: "Angebotsnummer",
    quoteDate: "Angebotsdatum",
    validUntil: "Gültig bis",
    servicePeriod: "Leistungszeitraum",
    serviceDate: "Leistungsdatum",
    serviceDateDefault: "entspricht Rechnungsdatum",
    customerNumber: "Kundennummer",
    leitwegId: "Leitweg-ID",
    buyerVatId: "Ihre USt-IdNr.",
    columns: { pos: "Pos.", description: "Beschreibung", quantity: "Menge", unitPrice: "Einzelpreis", vat: "USt", net: "Netto" },
    totalNet: "Summe netto",
    vat: (rate: string, base?: string) => (base ? `Umsatzsteuer ${rate} auf ${base}` : `Umsatzsteuer ${rate}`),
    totalGross: "Gesamtbetrag",
    quoteTotal: "Angebotssumme",
    reference: (number: string, date: string) => `zur Rechnung ${number} vom ${date}`,
    fromQuote: (number: string, date: string) => `Gemäß unserem Angebot ${number} vom ${date}.`,
    refund: "Der Betrag wird Ihnen erstattet.",
    noPayment: "Es ist keine Zahlung erforderlich.",
    payBy: (date: string) => `Bitte überweisen Sie den Betrag bis zum ${date} unter Angabe der Rechnungsnummer.`,
    quoteValid: (date: string) => `Dieses Angebot gilt bis zum ${date}. Wir freuen uns auf Ihren Auftrag.`,
    girocodeText: (number: string) => `Rechnung ${number}`,
    phone: "Tel.",
    taxNumber: "Steuernummer",
    vatId: "USt-IdNr.",
    page: (n: string, total: string) => `Seite ${n} von ${total}`,
    date: (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`,
    money: (cents: Cents) => formatEuro(cents),
    rate: (rate: number) => formatRate(rate),
    quantity: (quantity: Millis, unit: UnitLabel) => `${formatQuantity(quantity)} ${unit}`,
    note: (treatment: TaxTreatment, reason?: string | null) => treatmentNote(treatment, reason),
    countryLocale: "de",
  },
  en: {
    titles: { rechnung: "Invoice", storno: "Cancellation invoice", korrektur: "Corrective invoice", angebot: "Quote" } as Record<InvoiceKind | "angebot", string>,
    variants: { abschlag: "Partial invoice", schluss: "Final invoice" },
    confirmation: "Order confirmation",
    deliveryNote: "Delivery note",
    date_: "Date",
    quoteRef: "Quote",
    invoiceRef: "Invoice",
    deliveryDate: "Delivery date",
    orderTotal: "Order total",
    confirmationText: "Thank you for your order. We hereby confirm it with the items and prices listed above.",
    received: "Received in full and in good order:",
    signature: "Date, signature",
    deduction: (number: string, date: string, net: string, tax: string | null) =>
      `Less partial invoice ${number} of ${date} (net ${net}${tax ? `, VAT ${tax}` : ""})`,
    invoiceNumber: "Invoice number",
    invoiceDate: "Invoice date",
    quoteNumber: "Quote number",
    quoteDate: "Quote date",
    validUntil: "Valid until",
    servicePeriod: "Service period",
    serviceDate: "Date of service",
    serviceDateDefault: "same as invoice date",
    customerNumber: "Customer number",
    leitwegId: "Leitweg ID",
    buyerVatId: "Your VAT ID",
    columns: { pos: "No.", description: "Description", quantity: "Qty", unitPrice: "Unit price", vat: "VAT", net: "Net" },
    totalNet: "Total net",
    vat: (rate: string, base?: string) => (base ? `VAT ${rate} on ${base}` : `VAT ${rate}`),
    totalGross: "Total amount",
    quoteTotal: "Quote total",
    reference: (number: string, date: string) => `relating to invoice ${number} of ${date}`,
    fromQuote: (number: string, date: string) => `As per our quote ${number} of ${date}.`,
    refund: "The amount will be refunded to you.",
    noPayment: "No payment is required.",
    payBy: (date: string) => `Please transfer the amount by ${date}, quoting the invoice number.`,
    quoteValid: (date: string) => `This quote is valid until ${date}. We look forward to your order.`,
    girocodeText: (number: string) => `Invoice ${number}`,
    phone: "Phone",
    taxNumber: "Tax number",
    vatId: "VAT ID",
    page: (n: string, total: string) => `Page ${n} of ${total}`,
    date: (iso: string) => {
      const [y, m, d] = isoParts(iso);
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    },
    money: (cents: Cents) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(cents / 100),
    rate: (rate: number) => `${rate / 100} %`,
    quantity: (quantity: Millis, unit: UnitLabel) => {
      const value = quantity / 1000;
      const [one, many] = EN_UNITS[unit];
      return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value)} ${value === 1 ? one : many}`;
    },
    note: (treatment: TaxTreatment, reason?: string | null) => (treatment === "regulaer" ? null : reason?.trim() || EN_NOTES[treatment]),
    countryLocale: "en",
  },
} as const;

export type Texts = (typeof TEXTS)[Language];

export function texts(language: Language | undefined): Texts {
  return TEXTS[language ?? "de"];
}
