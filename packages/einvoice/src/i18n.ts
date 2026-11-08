import { formatEuro, formatPercent, formatQuantity, formatRate, treatmentNote, type Cents, type Millis, type TaxTreatment, type UnitLabel } from "@haben/core";
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
  ig_lieferung: "VAT-exempt intra-Community supply of goods (Art. 138 VAT Directive; § 4 No. 1(b), § 6a UStG).",
  ausfuhr: "VAT-exempt export of goods outside the EU (Art. 146 VAT Directive; § 4 No. 1(a), § 6 UStG).",
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
    orderReferences: { buyerOrder: "Ihre Bestellung", sellerOrder: "Unser Auftrag", despatchAdvice: "Lieferschein" },
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
    grossColumn: "Brutto",
    totalNet: "Summe netto",
    subtotal: "Zwischensumme",
    documentDiscount: (label: string | null) => (label ? `Gesamtrabatt ${label}` : "Gesamtrabatt"),
    lineDiscount: (label: string, amount: string | null) => `abzüglich ${label} Rabatt${amount ? ` (${amount})` : ""}`,
    optionalTag: "Optional, nicht in der Angebotssumme",
    alternativeTag: (position: string) => `Alternative zu Pos. ${position}, nicht in der Angebotssumme`,
    plan: {
      title: "Zahlungsplan",
      columns: { label: "Zahlung", due: "Fällig bei", share: "Anteil", amount: "Betrag" },
      rest: "Rest",
      netAndGross: (net: string, gross: string) => `${net} netto (${gross} brutto)`,
    },
    planAbschlag: (n: number, label: string, share: string | null, quote: string, date: string) =>
      `${n}. ${label}${share ? ` ${share}` : ""} gemäß Angebot ${quote} vom ${date}`,
    inclVat: (label: string) => `${label} (inkl. USt)`,
    included: "darin enthalten",
    includedNet: (rate?: string) => (rate ? `Netto ${rate}` : "Netto"),
    vat: (rate: string, base?: string) => (base ? `Umsatzsteuer ${rate} auf ${base}` : `Umsatzsteuer ${rate}`),
    totalGross: "Gesamtbetrag",
    inEuro: (rate: string) => `Umsatzsteuer in Euro, ${rate}`,
    vatInEuro: (rate: string) => `Umsatzsteuer ${rate}`,
    vatTotal: "Umsatzsteuer gesamt",
    quoteTotal: "Angebotssumme",
    reference: (number: string, date: string) => `zur Rechnung ${number} vom ${date}`,
    fromQuote: (number: string, date: string) => `Gemäß unserem Angebot ${number} vom ${date}.`,
    abschlagFromQuote: (number: string, date: string) => `Abschlag gemäß Angebot ${number} vom ${date}`,
    refund: "Der Betrag wird Ihnen erstattet.",
    noPayment: "Es ist keine Zahlung erforderlich.",
    payBy: (date: string) => `Bitte überweisen Sie den Betrag bis zum ${date} unter Angabe der Rechnungsnummer.`,
    skonto: (percent: string, date: string, amount: string, payable: string) =>
      `Bei Zahlung bis zum ${date} gewähren wir ${percent} Skonto (${amount}); Sie überweisen dann ${payable}.`,
    percent: (percent: number) => formatPercent(percent),
    quoteValid: (date: string) => `Dieses Angebot gilt bis zum ${date}. Wir freuen uns auf Ihren Auftrag.`,
    girocodeText: (number: string) => `Rechnung ${number}`,
    /** Entwurfs-PDF: Vermerk über jeder Seite und statt der Nummer, Platzhalter des GiroCodes, Teil des Dateinamens */
    draft: { mark: "ENTWURF", girocode: "erscheint im endgültigen PDF", file: "Entwurf" },
    phone: "Tel.",
    accountHolder: "Kontoinhaber",
    taxNumber: "Steuernummer",
    vatId: "USt-IdNr.",
    legal: {
      legalForm: "Rechtsform",
      seat: "Sitz der Gesellschaft",
      registerCourt: "Registergericht",
      managingDirectors: "Geschäftsführung",
      supervisoryBoardChair: "Vorsitz des Aufsichtsrats",
    },
    page: (n: string, total: string) => `Seite ${n} von ${total}`,
    date: (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`,
    money: (cents: Cents) => formatEuro(cents),
    rate: (rate: number) => formatRate(rate),
    quantity: (quantity: Millis, unit: UnitLabel) => `${formatQuantity(quantity)} ${unit}`,
    note: (treatment: TaxTreatment, reason?: string | null) => treatmentNote(treatment, reason),
    countryLocale: "de",
  },
  en: {
    titles: { rechnung: "Invoice", storno: "Cancellation invoice", korrektur: "Corrective invoice", angebot: "Quote" } as Record<
      InvoiceKind | "angebot",
      string
    >,
    variants: { abschlag: "Partial invoice", schluss: "Final invoice" },
    confirmation: "Order confirmation",
    deliveryNote: "Delivery note",
    date_: "Date",
    quoteRef: "Quote",
    invoiceRef: "Invoice",
    deliveryDate: "Delivery date",
    orderReferences: { buyerOrder: "Your order", sellerOrder: "Our order", despatchAdvice: "Delivery note" },
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
    grossColumn: "Gross",
    totalNet: "Total net",
    subtotal: "Subtotal",
    documentDiscount: (label: string | null) => (label ? `Discount ${label}` : "Discount"),
    lineDiscount: (label: string, amount: string | null) => `less ${label} discount${amount ? ` (${amount})` : ""}`,
    optionalTag: "Optional, not included in the quote total",
    alternativeTag: (position: string) => `Alternative to item ${position}, not included in the quote total`,
    plan: {
      title: "Payment schedule",
      columns: { label: "Payment", due: "Due on", share: "Share", amount: "Amount" },
      rest: "Balance",
      netAndGross: (net: string, gross: string) => `${net} net (${gross} gross)`,
    },
    planAbschlag: (n: number, label: string, share: string | null, quote: string, date: string) =>
      `${n}. ${label}${share ? ` ${share}` : ""} as per quote ${quote} of ${date}`,
    inclVat: (label: string) => `${label} (incl. VAT)`,
    included: "included",
    includedNet: (rate?: string) => (rate ? `Net ${rate}` : "Net"),
    vat: (rate: string, base?: string) => (base ? `VAT ${rate} on ${base}` : `VAT ${rate}`),
    totalGross: "Total amount",
    inEuro: (rate: string) => `VAT in euros, ${rate}`,
    vatInEuro: (rate: string) => `VAT ${rate}`,
    vatTotal: "Total VAT",
    quoteTotal: "Quote total",
    reference: (number: string, date: string) => `relating to invoice ${number} of ${date}`,
    fromQuote: (number: string, date: string) => `As per our quote ${number} of ${date}.`,
    abschlagFromQuote: (number: string, date: string) => `Progress payment as per quote ${number} of ${date}`,
    refund: "The amount will be refunded to you.",
    noPayment: "No payment is required.",
    payBy: (date: string) => `Please transfer the amount by ${date}, quoting the invoice number.`,
    skonto: (percent: string, date: string, amount: string, payable: string) =>
      `If paid by ${date}, you may deduct a ${percent} cash discount (${amount}) and transfer ${payable}.`,
    percent: (percent: number) => `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(percent / 100)}%`,
    quoteValid: (date: string) => `This quote is valid until ${date}. We look forward to your order.`,
    girocodeText: (number: string) => `Invoice ${number}`,
    draft: { mark: "DRAFT", girocode: "appears in the final PDF", file: "Draft" },
    phone: "Phone",
    accountHolder: "Account holder",
    taxNumber: "Tax number",
    vatId: "VAT ID",
    legal: {
      legalForm: "Legal form",
      seat: "Registered office",
      registerCourt: "Register court",
      managingDirectors: "Managing directors",
      supervisoryBoardChair: "Chair of the supervisory board",
    },
    page: (n: string, total: string) => `Page ${n} of ${total}`,
    date: (iso: string) => {
      const [y, m, d] = isoParts(iso);
      // ICU liefert je nach Plattform „Sep“ oder „Sept“; Belege und E-Mails verwenden einheitlich „Sept“.
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
        .formatToParts(new Date(Date.UTC(y, m - 1, d)))
        .map((part) => (part.type === "month" && part.value === "Sep" ? "Sept" : part.value))
        .join("");
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

/**
 * Texte einer Sprache; mit einer Fremdwährung formatiert money Beträge in dieser Währung („1.234,56 USD“),
 * euro bleibt immer Euro (Umsatzsteuer in Euro auf Fremdwährungsrechnungen).
 */
export function texts(language: Language | undefined, currency = "EUR"): Texts & { euro: (cents: Cents) => string } {
  const base = TEXTS[language ?? "de"];
  if (currency === "EUR") return { ...base, euro: base.money };
  const format = new Intl.NumberFormat(language === "en" ? "en-GB" : "de-DE", { style: "currency", currency, currencyDisplay: "code" });
  // Geschütztes Leerzeichen wie bei formatEuro, damit der Code nicht allein in die nächste Zeile rutscht
  return { ...base, euro: base.money, money: (cents: Cents) => format.format(cents / 100).replace(/\s/g, "\u00a0") };
}
