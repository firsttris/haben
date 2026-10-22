import type { BasisPoints, Cents, InvoiceTotals, Millis, PriceMode, TaxTreatment, UnitLabel } from "@haben/core";

/** Rechnung, Stornorechnung oder Rechnungskorrektur (Gutschrift) */
export type InvoiceKind = "rechnung" | "storno" | "korrektur";

/** Abschlagsrechnung über einen Teil der Leistung, Schlussrechnung über alles abzüglich der Abschläge */
export type InvoiceVariant = "abschlag" | "schluss";

/** zugferd = PDF/A-3 mit eingebettetem CII (Profil EN 16931); xrechnung-* = reines XML */
export type InvoiceFormat = "zugferd" | "xrechnung-cii" | "xrechnung-ubl";

export interface Address {
  strasse: string;
  plz: string;
  ort: string;
  /** ISO 3166-1 alpha-2, z. B. "DE" */
  land: string;
}

export interface Seller extends Address {
  name: string;
  email: string;
  telefon?: string;
  steuernummer?: string;
  ustId?: string;
  iban?: string;
  bic?: string;
  bank?: string;
}

export interface Buyer extends Address {
  name: string;
  email?: string;
  ustId?: string;
  /** Leitweg-ID öffentlicher Auftraggeber (BT-10) */
  leitwegId?: string;
  kundennummer?: string;
}

export interface InvoiceDocumentLine {
  position: number;
  description: string;
  quantity: Millis;
  unit: UnitLabel;
  /** Wie eingegeben: netto, bei Bruttopreisen brutto; bei Storno und Korrektur negativ */
  unitPrice: Cents;
  taxRate: BasisPoints;
  /** Zeilennetto, bei Bruttopreisen der Anteil an der Bemessungsgrundlage; bei Storno und Korrektur negativ */
  net: Cents;
}

/** Firmenlogo für den Briefkopf; PNG oder JPEG */
export interface Logo {
  data: Uint8Array;
  format: "png" | "jpg";
}

/**
 * Alles, was für PDF und XML einer festgeschriebenen Rechnung nötig ist.
 * Beträge sind wie gespeichert vorzeichenbehaftet (Storno negativ).
 */
export interface InvoiceDocument {
  kind: InvoiceKind;
  format: InvoiceFormat;
  number: string;
  /** ISO-Datum YYYY-MM-DD */
  issueDate: string;
  dueDate: string;
  paymentTermDays: number;
  serviceFrom?: string;
  serviceTo?: string;
  /** ISO-4217-Code; Beträge in lines und totals sind in dieser Währung */
  currency: string;
  seller: Seller;
  buyer: Buyer;
  lines: InvoiceDocumentLine[];
  totals: InvoiceTotals;
  /**
   * Nur bei Fremdwährung: Umsatzsteuer in Euro (§ 14 Abs. 4 Nr. 8 UStG, Abschn. 14.5 UStAE), je Satz und gesamt,
   * mit dem Kurs als Text für das PDF, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“. Im XML als
   * Steuerwährung EUR (BT-6) mit der Steuer in Euro (BT-111).
   */
  euroTax?: { tax: Cents; taxes: { rate: number; tax: Cents }[]; rate: string };
  /** Bei Storno und Korrektur: die ursprüngliche Rechnung */
  corrects?: { number: string; issueDate: string };
  note?: string;
  /** Fehlt = regulär besteuert */
  taxTreatment?: TaxTreatment;
  /** Fehlt = Nettopreise; brutto nur bei regulärer Besteuerung */
  priceMode?: PriceMode;
  /** Befreiungsgrund auf der Rechnung, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“; sonst der Standardtext */
  exemptionReason?: string;
  /** Nur für das PDF, nicht für das XML */
  logo?: Logo;
  /** Sprache des PDFs; fehlt = Deutsch */
  language?: "de" | "en";
  /** Nur bei kind „rechnung“; fehlt = normale Rechnung */
  variant?: InvoiceVariant;
  /** Schlussrechnung: abgezogene Abschlagsrechnungen (BT-25); die Abzüge selbst stehen als negative Positionen in lines */
  deducted?: { number: string; issueDate: string }[];
}
