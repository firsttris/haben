import { OTHER_TAX_PURPOSE, TAX_OFFICE, VAT_PURPOSE } from "./matching.ts";
import type { Cents } from "./money.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Einordnung von Belegen und Buchungen ohne Beleg aus Lexoffice oder sevDesk, die keine Einnahme oder Ausgabe des
 * Unternehmens sind. Berechnet zur Laufzeit aus den gespeicherten Kategorien, denn die archivierten Daten sind gesperrt.
 *
 * Einzelunternehmen: wie beim Abruf entschieden (Kennzeichen `privat` einer Buchung ohne Beleg): Privatentnahmen und
 * -einlagen, private Steuern, Geldtransit. Eine GmbH oder UG hat keine Privatsphäre: Geld zwischen ihr und dem
 * Gesellschafter läuft über das Verrechnungskonto, Stammkapital und Darlehen sind Kapital- bzw. Finanzierungsvorgänge,
 * und Körperschaft- und Gewerbesteuer samt Nebenleistungen (Zinsen, Säumniszuschläge) mindern das Einkommen nicht
 * (§ 10 Nr. 2 KStG: Steuern vom Einkommen; § 4 Abs. 5b EStG: Gewerbesteuer ist keine Betriebsausgabe). Lexware Office kennt dafür kein Merkmal, nur den Namen der Kategorie.
 */

export type LegacyNeutralKind = "privat" | "gesellschafter" | "kapital" | "ertragsteuern" | "geldtransit";

export const LEGACY_NEUTRAL_LABELS: Record<LegacyNeutralKind, string> = {
  privat: "Privat und Geldtransit",
  gesellschafter: "Gesellschafter (Verrechnungskonto, Einlagen, Entnahmen, Ausschüttungen)",
  kapital: "Stammkapital und Darlehen",
  ertragsteuern: "Körperschaft- und Gewerbesteuer",
  geldtransit: "Geldtransit",
};

/** Steuern vom Einkommen und Ertrag, auch ihre Nebenleistungen (§ 10 Nr. 2 Halbsatz 2 KStG) */
const ERTRAGSTEUERN = /körperschaftsteuer|koerperschaftsteuer|gewerbesteuer|solidarit/i;

/** Lohnsteuer samt Solidaritätszuschlag und Kirchensteuer darauf: Lohnaufwand, keine Steuer vom Einkommen der GmbH */
const PAYROLL = /lohn/i;

/** Kosten und Erträge, auch wenn der Name einen Gesellschafter oder ein Darlehen nennt */
const BUSINESS = /zins|gehalt|lohn|geschäftsführer|geschaeftsfuehrer|vergütung|verguetung|miete|pacht|gebühr|gebuehr|provision|beratung/i;

/** Nach den Ertragsteuern; Reihenfolge zählt: „Kapitaleinlage“ ist Kapital, nicht Einlage des Gesellschafters */
const KAPG_KINDS: [RegExp, LegacyNeutralKind][] = [
  [
    /stammkapital|grundkapital|gezeichnetes kapital|kapitalerhöhung|kapitalerhoehung|kapitalrücklage|kapitalruecklage|kapitaleinlage|darlehen|tilgung/i,
    "kapital",
  ],
  [/gesellschafter|verrechnungskonto|privat|einkommensteuer|kirchensteuer|ausschüttung|ausschuettung|kapitalertragsteuer|entnahme|einlage/i, "gesellschafter"],
];

function kapgKind(category: string): LegacyNeutralKind | null {
  if (/geldtransit/i.test(category)) return "geldtransit";
  if (PAYROLL.test(category)) return null;
  if (ERTRAGSTEUERN.test(category)) return "ertragsteuern";
  if (BUSINESS.test(category)) return null;
  return KAPG_KINDS.find(([pattern]) => pattern.test(category))?.[1] ?? null;
}

export interface LegacyNeutralInput {
  /** Kennzeichen der Buchung ohne Beleg aus dem Abruf (Einzelunternehmen) */
  privat: boolean;
  /** Namen der Kategorien in Lexoffice */
  categories: readonly string[];
  /** Umsatzsteuer des Belegs */
  tax: Cents;
}

/**
 * Was der Beleg ist, wenn er weder Einnahme noch Ausgabe ist; null = Einnahme bzw. Ausgabe. Bei GmbH und UG gilt ein
 * Beleg nur dann als neutral, wenn jede seiner Kategorien es ist; die Art kommt aus der ersten. Ein Beleg mit Umsatzsteuer
 * ist Leistungsaustausch (etwa private Kfz-Nutzung, § 3 Abs. 9a UStG) und bleibt Einnahme bzw. Ausgabe, auch mit
 * „privat“ oder „Gesellschafter“ im Namen; Verrechnung, Kapital und Steuern vom Einkommen tragen keine Umsatzsteuer.
 */
export function legacyNeutralKind(voucher: LegacyNeutralInput, rechtsform: Rechtsform): LegacyNeutralKind | null {
  if (!isKapitalgesellschaft(rechtsform)) return voucher.privat ? "privat" : null;
  if (voucher.tax !== 0) return null;
  const kinds = voucher.categories.map(kapgKind);
  if (kinds.length === 0 || kinds.some((k) => k === null)) return null;
  return kinds[0]!;
}

export interface LegacyNeutralSum {
  kind: LegacyNeutralKind;
  label: string;
  count: number;
  /** Geld herein (Einnahme-Seite), brutto; Gutschriften mindern */
  zufluss: Cents;
  /** Geld hinaus (Ausgabe-Seite), brutto; Gutschriften mindern */
  abfluss: Cents;
}

/** Summen je Art, in der Reihenfolge der Bezeichnungen */
export function legacyNeutralSums(vouchers: readonly { kind: LegacyNeutralKind; direction: "einnahme" | "ausgabe"; gross: Cents }[]): LegacyNeutralSum[] {
  return (Object.keys(LEGACY_NEUTRAL_LABELS) as LegacyNeutralKind[])
    .map((kind) => {
      const rows = vouchers.filter((v) => v.kind === kind);
      const sum = (direction: "einnahme" | "ausgabe") => rows.filter((r) => r.direction === direction).reduce((s, r) => s + r.gross, 0);
      return { kind, label: LEGACY_NEUTRAL_LABELS[kind], count: rows.length, zufluss: sum("einnahme"), abfluss: sum("ausgabe") };
    })
    .filter((s) => s.count > 0);
}

/**
 * Belegnummer, die Lexware Office der Zahllast einer übermittelten Voranmeldung gibt: „UStVA-“, Jahr, Zeitraum. Quelle:
 * echte Lexware-Daten aus Issue #269 („UStVA-2026-10“, offen beim Umzug unter dem Jahr).
 */
const LEXWARE_VAT_NUMBER = /^ustva\b/i;

/**
 * Steuerliche Nebenleistungen zur Umsatzsteuer (§ 3 Abs. 4 AO): Säumnis- und Verspätungszuschläge, Zinsen, Kosten. Sie sind
 * keine Umsatzsteuer, sondern Betriebsausgaben; § 12 Nr. 3 EStG schließt nur die zu nicht abziehbaren Steuern aus.
 */
const SIDE_PAYMENT = /säumnis|verspätung|zuschlag|zinsen|\bzins|mahngebühr|vollstreckung|zwangsgeld/i;

export interface LegacyVatPaymentInput {
  number: string;
  contactName: string;
  /** Namen der Kategorien in Lexoffice */
  categories: readonly string[];
  /** Umsatzsteuer des Belegs */
  tax: Cents;
}

/**
 * Ob ein Beleg aus Lexoffice die Umsatzsteuer an das Finanzamt ist (Zahllast der Voranmeldung, Sondervorauszahlung, #269).
 * Sie ist keine Betriebsausgabe einer Kategorie, sondern steht in der EÜR in „An das Finanzamt gezahlte Umsatzsteuer“ und
 * bucht auf das Konto der Vorauszahlungen. Erkennbar an der Belegnummer, die Lexware Office selbst vergibt, oder am
 * Finanzamt als Kontakt mit Umsatzsteuer in Kategorie bzw. Nummer, wie Haben die Lastschrift im Bankabgleich erkennt
 * (TAX_OFFICE, VAT_PURPOSE). Eine Zahllast trägt selbst keine Vorsteuer; andere Steuern desselben Finanzamts bleiben außen vor.
 */
export function isLegacyVatPayment(voucher: LegacyVatPaymentInput): boolean {
  if (voucher.tax !== 0) return false;
  const text = [voucher.number, ...voucher.categories].join(" ");
  if (OTHER_TAX_PURPOSE.test(text) || SIDE_PAYMENT.test(text)) return false;
  return LEXWARE_VAT_NUMBER.test(voucher.number) || (TAX_OFFICE.test(voucher.contactName) && VAT_PURPOSE.test(text));
}
