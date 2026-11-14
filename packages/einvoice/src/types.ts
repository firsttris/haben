import type { BasisPoints, Cents, Discount, InvoiceTotals, LegalInfo, LetterheadOptions, Millis, PriceMode, SkontoStufe, TaxTreatment } from "@haben/core";

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
  /** Inhaber des Kontos, wenn nicht der Firmenname (GiroCode, BT-85); fehlt = name */
  kontoinhaber?: string;
  /** GmbH und UG: Pflichtangaben auf Geschäftsbriefen (§ 35a Abs. 1 GmbHG); fehlt beim Einzelunternehmen und auf älteren Rechnungen */
  legalInfo?: LegalInfo;
}

/**
 * Ansprechpartner des Käufers (#424), Stand beim Festschreiben. Im PDF steht nur der Name („z. Hd. …“), in der E-Rechnung
 * der Name als BT-56; E-Mail, Telefon und Funktion dienen Haben (Kontaktseite, Auswahl), nicht dem Beleg.
 */
export interface Ansprechpartner {
  name: string;
  email?: string;
  telefon?: string;
  funktion?: string;
}

export interface Buyer extends Address {
  name: string;
  email?: string;
  ustId?: string;
  ansprechpartner?: Ansprechpartner;
  /** Leitweg-ID öffentlicher Auftraggeber (BT-10) */
  leitwegId?: string;
  kundennummer?: string;
}

/**
 * Referenzen auf Bestellung, Auftrag und Lieferschein (EN 16931-1): je höchstens eine Nummer, leer = keine.
 * Im XML an ihrem eigenen Feld statt als Freitext, im PDF im Kopfblock.
 */
export interface OrderReferences {
  /** Bestellnummer des Kunden (BT-13, Purchase order reference) */
  buyerOrder?: string;
  /** Eigene Auftragsnummer (BT-14, Sales order reference) */
  sellerOrder?: string;
  /** Lieferschein (BT-16, Despatch advice reference) */
  despatchAdvice?: string;
}

export interface InvoiceDocumentLine {
  position: number;
  /** Bezeichnung (BT-153) */
  description: string;
  /** Beschreibung unter der Bezeichnung, mehrzeilig (BT-154) */
  detail?: string;
  /** Artikelnummer des Verkäufers (BT-155), aus dem Artikel übernommen; leer = keine */
  itemNumber?: string;
  quantity: Millis;
  /** Bezeichnung der Einheit auf dem Blatt: fest (UNITS) oder eigene (#748) */
  unit: string;
  /** Code nach UN/ECE Rec. 20/21 (BT-130) für eine eigene Einheit; bei festen Einheiten fehlt er, dann gilt UNITS */
  unitCode?: string;
  /** Wie eingegeben: netto, bei Bruttopreisen brutto; bei Storno und Korrektur negativ */
  unitPrice: Cents;
  taxRate: BasisPoints;
  /** Zeilennetto nach Positionsrabatt (BT-131), bei Bruttopreisen der Anteil am Netto des Satzes; bei Storno und Korrektur negativ */
  net: Cents;
  /** Positionsrabatt wie eingegeben (BG-27); ein fester Betrag im Preismodus und mit dem Vorzeichen der Position */
  discount?: Discount;
  /** Schlussrechnung: Abzug einer Abschlagsrechnung; zählt nicht zur Grundlage des Gesamtrabatts */
  deductionOf?: string;
}

/** Firmenlogo für den Briefkopf; PNG oder JPEG */
export interface Logo {
  data: Uint8Array;
  format: "png" | "jpg";
}

/** Briefkopf aus den Einstellungen; nur für das PDF, nicht für das XML */
export interface Letterhead {
  logo?: Logo;
  /** Briefpapier als Bild hinter dem Beleg; nur PNG oder JPEG, ein PDF als Hintergrund geht in PDF/A-3b nicht */
  background?: Logo;
  /** #RRGGBB; fehlt = DEFAULT_ACCENT */
  accent?: string;
  /** Logo, Marken und Schalter aus dem Profil; fehlt = Vorgaben (DEFAULT_OPTIONS) */
  options?: LetterheadOptions;
  /**
   * Eigenes Layout: bekommt die fertigen Daten der Vorlage und liefert das PDF, das statt der eingebauten Vorlage gilt.
   * undefined = eingebaute Vorlage. Der Server nutzt das zweimal: einmal, um die Daten abzufangen, einmal mit dem PDF
   * aus dem Render-Prozess (withCustomLayout in apps/web).
   */
  pdfFrom?: (request: PdfRequest) => Uint8Array | undefined;
}

/** Was eine Vorlage zum Setzen bekommt; data ist schon mit dem Briefkopf ergänzt (templateInputs) */
export interface PdfRequest {
  /** Eingebaute Vorlage, für die die Daten gedacht sind */
  template: "rechnung.typ" | "mahnung.typ";
  data: object;
  date: string;
}

/**
 * Alles, was für PDF und XML einer festgeschriebenen Rechnung nötig ist.
 * Beträge sind wie gespeichert vorzeichenbehaftet (Storno negativ).
 */
export interface InvoiceDocument extends Letterhead {
  kind: InvoiceKind;
  format: InvoiceFormat;
  number: string;
  /** ISO-Datum YYYY-MM-DD */
  issueDate: string;
  dueDate: string;
  paymentTermDays: number;
  /** Skonto nach Frist ab dem Rechnungsdatum; nur bei Rechnungen mit Zahlbetrag, fehlt = ohne Abzug */
  skonto?: SkontoStufe[];
  serviceFrom?: string;
  serviceTo?: string;
  /** ISO-4217-Code; Beträge in lines und totals sind in dieser Währung */
  currency: string;
  seller: Seller;
  buyer: Buyer;
  lines: InvoiceDocumentLine[];
  totals: InvoiceTotals;
  /** Gesamtrabatt wie eingegeben; je Satz als Document level allowance (BG-20), abgeleitet aus Zeilennetto und Steuerzeilen */
  discount?: Discount;
  /**
   * Nur bei Fremdwährung: Umsatzsteuer in Euro (§ 14 Abs. 4 Nr. 8 UStG, Abschn. 14.5 UStAE), je Satz und gesamt,
   * mit dem Kurs als Text für das PDF, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“. Im XML als
   * Steuerwährung EUR (BT-6) mit der Steuer in Euro (BT-111).
   */
  euroTax?: { tax: Cents; taxes: { rate: number; tax: Cents }[]; rate: string };
  /** Bei Storno und Korrektur: die ursprüngliche Rechnung */
  corrects?: { number: string; issueDate: string };
  /** Einleitung über den Positionen (Kopftext) */
  intro?: string;
  /** Hinweis unter den Summen (Fußtext) */
  note?: string;
  /** Fester Aufbewahrungshinweis für private Grundstücksleistungen (§ 14 Abs. 4 Nr. 9, § 14b Abs. 1 Satz 5 UStG); fehlt = aus */
  propertyRetention?: boolean;
  /** Fehlt = regulär besteuert */
  taxTreatment?: TaxTreatment;
  /** Fehlt = Nettopreise; brutto nur bei regulärer Besteuerung */
  priceMode?: PriceMode;
  /** Befreiungsgrund auf der Rechnung, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“; sonst der Standardtext */
  exemptionReason?: string;
  /** Sprache des PDFs; fehlt = Deutsch */
  language?: "de" | "en";
  /** Nur bei kind „rechnung“; fehlt = normale Rechnung */
  variant?: InvoiceVariant;
  /** Schlussrechnung: abgezogene Abschlagsrechnungen (BT-25); die Abzüge selbst stehen als negative Positionen in lines */
  deducted?: { number: string; issueDate: string }[];
  /** Bestell-, Auftrags- und Lieferscheinnummer (BT-13, BT-14, BT-16) */
  references?: OrderReferences;
  /** Einzug per SEPA-Lastschrift (#445); fehlt = Überweisung. Nur bei Rechnungen mit Zahlbetrag in Euro */
  directDebit?: DirectDebit;
}

/** Angaben zum Einzug: im PDF die Vorabankündigung, im XML Zahlungsart 59 mit BT-89, BT-90 und BT-91 */
export interface DirectDebit {
  /** Mandatsreferenz (BT-89) */
  mandateReference: string;
  /** Gläubiger-ID des Verkäufers (BT-90) */
  creditorId: string;
  /** IBAN des Kunden, von der eingezogen wird (BT-91) */
  debtorIban: string;
  /** Tag des Einzugs (Fälligkeit der Lastschrift) */
  collectionDate: string;
}
