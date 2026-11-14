import { roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";
import type { InvoiceTotals, TaxRate } from "./invoice.ts";
import type { TaxTreatment } from "./treatment.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { isKapitalgesellschaft, ownerLabels, type Rechtsform } from "./rechtsform.ts";

export type Kontenrahmen = "SKR03" | "SKR04";
export type Versteuerung = "ist" | "soll";

/** Konten, die Haben bisher bebucht. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const ACCOUNTS = {
  SKR03: {
    forderungen: "1400",
    bank: "1200",
    kasse: "1000",
    erloese: { 1900: "8400", 700: "8300", 0: "8200" },
    erloeseSonder: {
      reverse_charge: "8336",
      drittland: "8338",
      eu_sonstige: "8339",
      ig_lieferung: "8125",
      ausfuhr: "8120",
      steuerfrei: "8100",
      kleinunternehmer: "8195",
    },
    ust: { 1900: "1776", 700: "1771" },
    ustNichtFaellig: { 1900: "1766", 700: "1761" },
    vorsteuer: { 1900: "1576", 700: "1571" },
    /**
     * Zwischenkonto für die Vorsteuer einer Gutschrift, die bereits Bezahltes erstattet (#786): Die Berichtigung wird nach
     * § 17 Abs. 1 Satz 2 und 8 UStG erst gezogen, wenn das Geld zurückkommt oder verrechnet wird. DATEV-Kontenrahmen 2026,
     * SKR03 1548 „Vorsteuer in Folgeperiode/im Folgejahr abziehbar“ (sonstige Vermögensgegenstände; kein Automatikkonto,
     * keine eigene Kennzahl, also nicht in Kz 66).
     */
    vorsteuerNochNichtAbziehbar: "1548",
    /** § 13b: selbst geschuldete Umsatzsteuer und die Vorsteuer daraus */
    ustRc: "1787",
    vorsteuerRc: "1577",
    /**
     * Innergemeinschaftlicher Erwerb (§ 1a UStG): Erwerbsteuer und Vorsteuer daraus, je Satz (DATEV-Kontenrahmen SKR03 2026;
     * 1772 und 1572 sind die Konten ohne Satz, Haben nimmt sie für 7 %). Kein Automatikkonto: Haben bucht die Steuer selbst.
     */
    ustIge: { 1900: "1774", 700: "1772" },
    vorsteuerIge: { 1900: "1574", 700: "1572" },
    verbindlichkeiten: "1600",
    /** DATEV SKR03 2026, Art.-Nr. 11174, S. 10: Anzahlungen ohne AM-Funktion; Umsatzsteuer wird separat gebucht. */
    erhalteneAnzahlungen: "1710",
    /**
     * Verrechnungskonto für zwei Belege ohne Zahlung (#274, #786): DATEV-Kontenrahmen 2026, SKR03 1590 „Durchlaufende
     * Posten“ (sonstige Vermögensgegenstände oder sonstige Verbindlichkeiten). Je Verrechnung bucht jede Belegseite ihren
     * Anteil hierher, Rechnung und Gutschrift zusammen auf null; kein Automatikkonto, die Buchung trägt keine Steuer.
     */
    verrechnung: "1590",
    privateinlagen: "1890",
    privatentnahmen: "1800",
    /** Spenden aus dem Betrieb, im Einzelunternehmen privat (Sonderausgabe, § 10b EStG); DATEV SKR03 1840 „Zuwendungen, Spenden“ */
    spenden: "1840",
    /** GmbH, UG: Gesellschafter-Verrechnungskonto statt Privat (DATEV SKR03: Verbindlichkeiten gegenüber Gesellschaftern) */
    gesellschafter: "0730",
    /** GmbH, UG: einbehaltene KapESt, Soli und KiSt auf offene Ausschüttungen (DATEV SKR03 1746) */
    kapestEinbehalt: "1746",
    geldtransit: "1360",
    ustVorauszahlung: "1780",
    /** Sondervorauszahlung bei Dauerfristverlängerung, „Umsatzsteuer-Vorauszahlungen 1/11“ (DATEV SKR03 1781) */
    sondervorauszahlung: "1781",
    nebenkostenGeldverkehr: "4970",
    saldenvortrag: "9000",
    /** Bezahlte Mahngebühren, Pauschalen und Verzugszinsen: kein Entgelt für eine Leistung, deshalb ohne Umsatzsteuer */
    mahnerloes: "2650",
    /** Zinsen auf Guthaben eines betrieblichen Kontos (DATEV SKR03 2650 „Sonstige Zinsen und ähnliche Erträge“) */
    zinsertraege: "2650",
    /** Ausbuchungen (§ 17 UStG): gewährte und erhaltene Skonti, Forderungsverluste */
    skontiGewaehrt: "8730",
    skontiErhalten: "3730",
    forderungsverluste: "2400",
    /** Kursdifferenzen bei Fremdwährung: ohne Umsatzsteuer, die bleibt beim Kurs der Rechnung (§ 16 Abs. 6 UStG) */
    kursAufwand: "2150",
    kursErtrag: "2660",
  },
  SKR04: {
    forderungen: "1200",
    bank: "1800",
    kasse: "1600",
    erloese: { 1900: "4400", 700: "4300", 0: "4200" },
    erloeseSonder: {
      reverse_charge: "4336",
      drittland: "4338",
      eu_sonstige: "4339",
      ig_lieferung: "4125",
      ausfuhr: "4120",
      steuerfrei: "4100",
      kleinunternehmer: "4185",
    },
    ust: { 1900: "3806", 700: "3801" },
    ustNichtFaellig: { 1900: "3816", 700: "3811" },
    vorsteuer: { 1900: "1406", 700: "1401" },
    /** Zwischenkonto wie SKR03 1548; DATEV-Kontenrahmen 2026, SKR04 1434 „Vorsteuer in Folgeperiode/im Folgejahr abziehbar“ */
    vorsteuerNochNichtAbziehbar: "1434",
    ustRc: "3837",
    vorsteuerRc: "1407",
    /** Innergemeinschaftlicher Erwerb (DATEV-Kontenrahmen SKR04 2026; 3802 und 1402 ohne Satz, für 7 %) */
    ustIge: { 1900: "3804", 700: "3802" },
    vorsteuerIge: { 1900: "1404", 700: "1402" },
    verbindlichkeiten: "3300",
    /** DATEV SKR04 2026, Art.-Nr. 11175, S. 11: Anzahlungen ohne AM-Funktion; Umsatzsteuer wird separat gebucht. */
    erhalteneAnzahlungen: "3250",
    /** Verrechnungskonto wie SKR03 1590; DATEV-Kontenrahmen 2026, SKR04 1370 „Durchlaufende Posten“ */
    verrechnung: "1370",
    privateinlagen: "2180",
    privatentnahmen: "2100",
    /** DATEV SKR04 2250 „Zuwendungen, Spenden“ */
    spenden: "2250",
    /** GmbH, UG: Gesellschafter-Verrechnungskonto statt Privat (DATEV SKR04: Verbindlichkeiten gegenüber Gesellschaftern) */
    gesellschafter: "3510",
    kapestEinbehalt: "3760",
    geldtransit: "1460",
    ustVorauszahlung: "3820",
    /** „Umsatzsteuer-Vorauszahlung 1/11“ (DATEV SKR04 3830) */
    sondervorauszahlung: "3830",
    nebenkostenGeldverkehr: "6855",
    saldenvortrag: "9000",
    mahnerloes: "7100",
    zinsertraege: "7100",
    skontiGewaehrt: "4730",
    skontiErhalten: "5730",
    forderungsverluste: "6930",
    kursAufwand: "6880",
    kursErtrag: "4840",
  },
} as const;

/**
 * Gegenkonto für Geld zwischen Unternehmen und Inhaber: im Einzelunternehmen Privateinlage (Geld kommt ins Unternehmen)
 * bzw. Privatentnahme, in GmbH und UG für beide Richtungen das Gesellschafter-Verrechnungskonto. Eine Kapitalgesellschaft
 * hat kein Privat; was der Gesellschafter auslegt oder bekommt, ist eine Forderung bzw. Verbindlichkeit ihm gegenüber.
 */
export function ownerAccount(kontenrahmen: Kontenrahmen, rechtsform: Rechtsform, direction: "einlage" | "entnahme"): string {
  const accounts = ACCOUNTS[kontenrahmen];
  if (isKapitalgesellschaft(rechtsform)) return accounts.gesellschafter;
  return direction === "einlage" ? accounts.privateinlagen : accounts.privatentnahmen;
}

/**
 * Ausgabenkategorien für Belege mit Aufwandskonto je Kontenrahmen.
 * Vor dem Echtbetrieb mit dem Steuerberater abgleichen.
 */
export const EXPENSE_CATEGORIES = {
  software: { label: "Software und Lizenzen", SKR03: "4964", SKR04: "6837" },
  edv: { label: "Hosting und IT-Dienste", SKR03: "4806", SKR04: "6495" },
  // DATEV „Reparaturen und Instandhaltung von anderen Anlagen und Betriebs- und Geschäftsausstattung“ (#312); EDV und Kfz
  // haben eigene Kategorien
  reparatur: { label: "Reparatur und Instandhaltung (Ausstattung, ohne EDV und Kfz)", SKR03: "4805", SKR04: "6470" },
  // DATEV „Miete (unbewegliche Wirtschaftsgüter)“: Geschäftsräume und betrieblich genutzte Grundstücke (#312)
  miete: { label: "Miete für Geschäftsräume", SKR03: "4210", SKR04: "6310" },
  hardware: { label: "Hardware (GWG bis 800 € netto)", SKR03: "0480", SKR04: "0670" },
  telefon: { label: "Telefon", SKR03: "4920", SKR04: "6805" },
  internet: { label: "Internet", SKR03: "4925", SKR04: "6810" },
  buero: { label: "Bürobedarf", SKR03: "4930", SKR04: "6815" },
  // DATEV „Sonstiger Betriebsbedarf“: laufendes Verbrauchsmaterial außer Bürobedarf (#312)
  betriebsbedarf: { label: "Sonstiger Betriebsbedarf", SKR03: "4980", SKR04: "6850" },
  literatur: { label: "Fachliteratur", SKR03: "4940", SKR04: "6820" },
  fortbildung: { label: "Fortbildung", SKR03: "4945", SKR04: "6821" },
  fahrtkosten: { label: "Reisekosten: Fahrten", SKR03: "4673", SKR04: "6673" },
  uebernachtung: { label: "Reisekosten: Übernachtung", SKR03: "4676", SKR04: "6680" },
  porto: { label: "Porto", SKR03: "4910", SKR04: "6800" },
  werbung: { label: "Werbung", SKR03: "4600", SKR04: "6600" },
  // Bewirtung: 70 % Betriebsausgabe, die Vorsteuer voll (§ 4 Abs. 5 Nr. 2 EStG); die Aufteilung macht die EÜR
  bewirtung: { label: "Bewirtung von Geschäftspartnern (70 % abziehbar)", SKR03: "4650", SKR04: "6640" },
  geschenke: { label: "Geschenke an Geschäftspartner (bis 50 € je Empfänger und Jahr)", SKR03: "4630", SKR04: "6610" },
  beratung: { label: "Rechts- und Beratungskosten", SKR03: "4950", SKR04: "6825" },
  buchfuehrung: { label: "Buchführung und Steuerberatung", SKR03: "4955", SKR04: "6830" },
  // Waren zum Weiterverkauf; DATEV „Wareneingang“, Vorsteuer je nach Beleg
  wareneinkauf: { label: "Wareneinkauf (Handelsware)", SKR03: "3200", SKR04: "5200" },
  fremdleistung: { label: "Fremdleistungen", SKR03: "3100", SKR04: "5900" },
  geldverkehr: { label: "Kontoführung und Gebühren", SKR03: "4970", SKR04: "6855" },
  kfzBetrieb: { label: "Kfz: Laden, Tanken, Wartung", SKR03: "4530", SKR04: "6530" },
  kfzVersicherung: { label: "Kfz: Versicherung", SKR03: "4520", SKR04: "6520" },
  kfzSteuer: { label: "Kfz: Steuer", SKR03: "4510", SKR04: "7685" },
  kfzReparatur: { label: "Kfz: Reparaturen", SKR03: "4540", SKR04: "6540" },
  kfzLeasing: { label: "Kfz: Leasing", SKR03: "4570", SKR04: "6560" },
  // DATEV „Sonstige Fahrzeugkosten“: was nicht Laden/Tanken, Versicherung, Steuer, Reparatur oder Leasing ist (#312)
  kfzSonstige: { label: "Kfz: sonstige Kosten", SKR03: "4580", SKR04: "6570" },
  versicherung: { label: "Versicherungen", SKR03: "4360", SKR04: "6400" },
  beitraege: { label: "Beiträge", SKR03: "4380", SKR04: "6420" },
  // Personalaufwand (soziale Abgaben, § 275 Abs. 2 Nr. 6b HGB), DATEV „Beiträge zur Berufsgenossenschaft“ (#312)
  berufsgenossenschaft: { label: "Beiträge zur Berufsgenossenschaft", SKR03: "4138", SKR04: "6120" },
  // DATEV „Versorgungskassen“: betriebliche Altersversorgung der Arbeitnehmer (§ 4c EStG). Die eigene Vorsorge des
  // Inhabers ist keine Betriebsausgabe (§ 12 Nr. 1 EStG), sie ist eine Entnahme (#312)
  versorgungskassen: { label: "Versorgungskassen (Altersversorgung der Arbeitnehmer)", SKR03: "4160", SKR04: "6150" },
  sonstiges: { label: "Sonstiger Aufwand", SKR03: "4900", SKR04: "6300" },
  // Kein Aufwand: gebucht wird auf das Anlagekonto der Anlage, abgeschrieben über das Anlagenverzeichnis
  anlage: { label: "Anlagegut (wird abgeschrieben)", SKR03: "0490", SKR04: "0690" },
  // Kein Aufwand: Bescheid des Zolls über die Einfuhrumsatzsteuer, der ganze Betrag ist Vorsteuer (§ 15 Abs. 1 Satz 1 Nr. 2
  // UStG, Kz 62); DATEV-Kontenrahmen 2026 „Entstandene Einfuhrumsatzsteuer“ (SKR03 1588, SKR04 1433)
  einfuhrumsatzsteuer: { label: "Einfuhrumsatzsteuer (Bescheid des Zolls)", SKR03: "1588", SKR04: "1433" },
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as [ExpenseCategory, ...ExpenseCategory[]];

export const ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    // Kapitalgesellschaft: Gesellschafter und Eigenkapital (DATEV-Kontenrahmen SKR03 2026, Art.-Nr. 11174)
    "0730": "Verbindlichkeiten gegenüber Gesellschaftern",
    "0731": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit bis 1 Jahr",
    "0740": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit 1 bis 5 Jahre",
    "0750": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit größer 5 Jahre",
    "0800": "Gezeichnetes Kapital",
    // Steuern vom Einkommen und Ertrag und ihre Rückstellungen (koerperschaft.ts)
    "0955": "Steuerrückstellungen",
    "0956": "Gewerbesteuerrückstellung nach § 4 Abs. 5b EStG",
    "0963": "Körperschaftsteuerrückstellung",
    "2200": "Körperschaftsteuer",
    "2208": "Solidaritätszuschlag",
    "4320": "Gewerbesteuer",
    "0860": "Gewinnvortrag vor Verwendung",
    "0868": "Verlustvortrag vor Verwendung",
    "1000": "Kasse",
    "1200": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`136${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    "1400": "Forderungen aus Lieferungen und Leistungen",
    "1761": "Umsatzsteuer nicht fällig 7 %",
    "1766": "Umsatzsteuer nicht fällig 19 %",
    "1771": "Umsatzsteuer 7 %",
    "1776": "Umsatzsteuer 19 %",
    "1787": "Umsatzsteuer nach § 13b UStG",
    "1548": "Vorsteuer in Folgeperiode/im Folgejahr abziehbar",
    "1590": "Verrechnungskonto (durchlaufende Posten)",
    "1572": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb",
    "1574": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "1772": "Umsatzsteuer aus innergemeinschaftlichem Erwerb",
    "1774": "Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "8120": "Steuerfreie Umsätze § 4 Nr. 1a UStG",
    "8125": "Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG",
    "2150": "Aufwendungen aus Kursdifferenzen",
    "2400": "Forderungsverluste (übliche Höhe)",
    "2650": "Sonstige Zinsen und ähnliche Erträge",
    "2660": "Erträge aus Kursdifferenzen",
    "3730": "Erhaltene Skonti",
    "8730": "Gewährte Skonti",
    "8100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "8195": "Erlöse als Kleinunternehmer § 19 UStG",
    "8200": "Erlöse",
    "8300": "Erlöse 7 % USt",
    "8336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "8338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "8339": "Erlöse aus im anderen EU-Land steuerbaren sonstigen Leistungen ohne B2B-Reverse-Charge",
    "8400": "Erlöse 19 % USt",
    "9000": "Saldenvorträge Sachkonten",
  },
  SKR04: {
    "1200": "Forderungen aus Lieferungen und Leistungen",
    "1600": "Kasse",
    "1800": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`146${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    // Kapitalgesellschaft: Gesellschafter und Eigenkapital (DATEV-Kontenrahmen SKR04 2026, Art.-Nr. 11175)
    "2900": "Gezeichnetes Kapital",
    "3020": "Steuerrückstellungen",
    "3035": "Gewerbesteuerrückstellung nach § 4 Abs. 5b EStG",
    "3040": "Körperschaftsteuerrückstellung",
    "7600": "Körperschaftsteuer",
    "7608": "Solidaritätszuschlag",
    "7610": "Gewerbesteuer",
    "2970": "Gewinnvortrag vor Verwendung",
    "2978": "Verlustvortrag vor Verwendung",
    "3510": "Verbindlichkeiten gegenüber Gesellschaftern",
    "3511": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit bis 1 Jahr",
    "3514": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit 1 bis 5 Jahre",
    "3801": "Umsatzsteuer 7 %",
    "3806": "Umsatzsteuer 19 %",
    "3837": "Umsatzsteuer nach § 13b UStG",
    "1434": "Vorsteuer in Folgeperiode/im Folgejahr abziehbar",
    "1370": "Verrechnungskonto (durchlaufende Posten)",
    "1402": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb",
    "1404": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "3802": "Umsatzsteuer aus innergemeinschaftlichem Erwerb",
    "3804": "Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "4120": "Steuerfreie Umsätze § 4 Nr. 1a UStG",
    "4125": "Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG",
    "3811": "Umsatzsteuer nicht fällig 7 %",
    "3816": "Umsatzsteuer nicht fällig 19 %",
    "4100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "4185": "Erlöse als Kleinunternehmer § 19 UStG",
    "4200": "Erlöse",
    "4300": "Erlöse 7 % USt",
    "4336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "4338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "4339": "Erlöse aus im anderen EU-Land steuerbaren sonstigen Leistungen ohne B2B-Reverse-Charge",
    "4400": "Erlöse 19 % USt",
    "4730": "Gewährte Skonti",
    "4840": "Erträge aus Kursdifferenzen",
    "5730": "Erhaltene Skonti",
    "6880": "Aufwendungen aus Kursdifferenzen",
    "6930": "Forderungsverluste (übliche Höhe)",
    "7100": "Sonstige Zinsen und ähnliche Erträge",
    "9000": "Saldenvorträge Sachkonten",
  },
};

/**
 * Steuerschlüssel einer Buchungszeile, mit Kennzahl der Voranmeldung: USt19 (Kz 81), USt7 (86), frei,
 * RC (21), Drittland (45), Steuerfrei (48), KU (Kleinunternehmer), VSt19/VSt7 (66), keineVSt,
 * RC13bEU (46/47), RC13bDrittland (84/85), VSt13b (67), IGL (41, innergemeinschaftliche Lieferung),
 * Ausfuhr (43), IGE19/IGE7 (89/93, innergemeinschaftlicher Erwerb), VStIGE (61), EUSt (62, Einfuhrumsatzsteuer)
 */
export type TaxCode =
  | "USt19"
  | "USt7"
  | "frei"
  | "RC"
  | "Drittland"
  | "NichtSteuerbar"
  | "Steuerfrei"
  | "KU"
  | "VSt19"
  | "VSt7"
  | "keineVSt"
  | "RC13bEU"
  | "RC13bDrittland"
  | "VSt13b"
  | "IGL"
  | "Ausfuhr"
  | "IGE19"
  | "IGE7"
  | "VStIGE"
  | "EUSt";

/**
 * Steuerschuld als Leistungsempfänger (§ 13b UStG) für Belege: sonstige Leistungen eines Unternehmers
 * aus dem übrigen EU-Gebiet (Abs. 1, Kz 46/47) oder aus dem Drittland (Abs. 2 Nr. 1, Kz 84/85)
 */
export type ReverseChargeIn = "eu" | "drittland";

export const REVERSE_CHARGE_IN: Record<ReverseChargeIn, { label: string; code: "RC13bEU" | "RC13bDrittland"; kz: string; taxKz: string }> = {
  eu: { label: "Leistung eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG)", code: "RC13bEU", kz: "46", taxKz: "47" },
  drittland: { label: "Leistung eines Unternehmers aus dem Drittland (§ 13b Abs. 2 Nr. 1 UStG)", code: "RC13bDrittland", kz: "84", taxKz: "85" },
};

/**
 * Steuer, die du am Eingangsbeleg selbst schuldest: § 13b (eu, drittland) oder innergemeinschaftlicher Erwerb (§ 1a UStG).
 * Beim Erwerb entsteht die Steuer mit Ausstellung der Rechnung, spätestens mit Ablauf des Folgemonats (§ 13 Abs. 1 Nr. 6
 * UStG), auch bei Ist-Versteuerung; Haben nimmt dafür das Belegdatum.
 */
export type SelfAssessedTax = ReverseChargeIn | "ig_erwerb";

export const SELF_ASSESSED_TAX_KEYS = ["eu", "drittland", "ig_erwerb"] as const satisfies readonly SelfAssessedTax[];

export const IG_ERWERB = {
  label: "Innergemeinschaftlicher Erwerb (§ 1a UStG): Ware von einem Unternehmer aus dem EU-Ausland",
  code: { 1900: "IGE19", 700: "IGE7" },
  kz: { 1900: "89", 700: "93" },
  taxKz: "61",
} as const;

const TREATMENT_TAX_CODES = {
  reverse_charge: "RC",
  drittland: "Drittland",
  eu_sonstige: "NichtSteuerbar",
  ig_lieferung: "IGL",
  ausfuhr: "Ausfuhr",
  steuerfrei: "Steuerfrei",
  kleinunternehmer: "KU",
} as const;

export function revenueTaxCode(rate: BasisPoints, treatment: TaxTreatment = "regulaer"): TaxCode {
  if (treatment !== "regulaer") {
    if (rate !== 0) throw new RangeError(`${treatment}: Steuersatz muss 0 % sein`);
    return TREATMENT_TAX_CODES[treatment];
  }
  if (rate === 1900) return "USt19";
  if (rate === 700) return "USt7";
  if (rate === 0) return "frei";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

/** Steuersatz mit eigenem Umsatzsteuer- und Vorsteuerkonto */
export function vatRate(rate: BasisPoints): Exclude<TaxRate, 0> {
  if (rate !== 1900 && rate !== 700) throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
  return rate;
}

export interface PostingLine {
  account: string;
  debit: Cents;
  credit: Cents;
  taxCode: TaxCode | null;
  /**
   * Bemessungsgrundlage zum Steuerschlüssel, wenn sie nicht der Betrag der Zeile ist, in Cent mit Vorzeichen: positiv
   * erhöht die Kennzahl, negativ (Rücklastschrift, Storno) mindert sie. Bei Ist-Versteuerung an der Zahlung: an der
   * Umbuchung der Steuer, für den Anteil zu 0 % an der Forderung, für einen Anteil ohne Steuer (gerundet 0,00 €) an einer
   * Umsatzsteuerzeile ohne Betrag (#542; DATEV: Steuerschlüssel am Zahlungseingang, Dok. 1080673)
   */
  basis?: Cents | null;
}

/** Buchungszeile: positiv auf die gewünschte Seite, negativ (Gutschrift, Storno) auf die andere */
export function side(account: string, amount: Cents, debitIfPositive: boolean, taxCode: TaxCode | null): PostingLine {
  const debit = debitIfPositive ? amount > 0 : amount < 0;
  return { account, debit: debit ? Math.abs(amount) : 0, credit: debit ? 0 : Math.abs(amount), taxCode };
}

/**
 * Buchung einer festgeschriebenen Ausgangsrechnung: Forderung an Erlöse und Umsatzsteuer.
 * Bei Ist-Versteuerung auf „Umsatzsteuer nicht fällig“; fällig wird sie mit dem Zahlungseingang.
 * Negative Summen (Storno, Korrektur) drehen die Seiten. Reverse Charge, Drittland, steuerfreie
 * und Kleinunternehmer-Umsätze gehen auf eigene Erlöskonten.
 */
export function invoicePosting(
  totals: InvoiceTotals,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, base, tax } of totals.taxes) {
    const code = revenueTaxCode(rate, treatment);
    const revenue = treatment === "regulaer" ? accounts.erloese[rate === 0 ? 0 : vatRate(rate)] : accounts.erloeseSonder[treatment];
    if (base !== 0) lines.push(side(revenue, base, false, code));
    if (tax !== 0) {
      const taxAccounts = versteuerung === "ist" ? accounts.ustNichtFaellig : accounts.ust;
      lines.push(side(taxAccounts[vatRate(rate)], tax, false, code));
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

export function inputTaxCode(rate: BasisPoints): TaxCode {
  if (rate === 1900) return "VSt19";
  if (rate === 700) return "VSt7";
  if (rate === 0) return "keineVSt";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

/** Wie ein Beleg bezahlt wird: offen über die Bank (Abgleich in Phase 4) oder privat ausgelegt. */
export type DocumentPayment = "bank" | "privat" | "kasse";

export { documentPosting, einfuhrumsatzsteuerIssues } from "./document-posting.ts";

/** Netto und Steuer je Satz, die auf eine Zahlung oder Ausbuchung entfallen */
export interface TaxShare {
  rate: BasisPoints;
  base: Cents;
  tax: Cents;
}

/**
 * Anteil der Steuer je Satz, der auf eine (Teil-)Zahlung entfällt. Rundung so verteilt,
 * dass die Summe dem gerundeten Gesamtanteil entspricht.
 */
export function paidTaxShares(totals: InvoiceTotals, paid: Cents): TaxShare[] {
  if (totals.gross === 0) return [];
  const share = (value: Cents) => roundHalfAwayFromZero((value * paid) / totals.gross);
  const totalTax = share(totals.tax);
  const totalNet = paid - totalTax;
  const rows = totals.taxes.map((t) => ({ rate: t.rate, base: share(t.base), tax: share(t.tax) }));
  // Rundungsrest dem größten Posten zuschlagen
  const largest = rows.reduce((best, row, i) => (Math.abs(row.base) > Math.abs(rows[best]!.base) ? i : best), 0);
  if (rows[largest]) {
    rows[largest]!.tax += totalTax - rows.reduce((s, r) => s + r.tax, 0);
    rows[largest]!.base += totalNet - rows.reduce((s, r) => s + r.base, 0);
  }
  return rows;
}

/**
 * Anteil einer weiteren Zahlung bzw. Ausbuchung auf eine Rechnung: der Anteil am dann Erledigten abzüglich dessen, was
 * die bisherigen schon erfasst haben. Einzeln gerundet ergäben 3 × 39,67 € auf 119 € nur 18,99 € Steuer; so ergeben alle
 * zusammen genau die Steuer der Rechnung, auch nach einer aufgehobenen Zahlung dazwischen.
 */
export function settlementTaxShares(totals: InvoiceTotals, settledBefore: Cents, recordedBefore: TaxShare[], amount: Cents): TaxShare[] {
  return paidTaxShares(totals, settledBefore + amount).map((target) => {
    const recorded = recordedBefore.filter((r) => r.rate === target.rate);
    return {
      rate: target.rate,
      base: target.base - recorded.reduce((sum, r) => sum + r.base, 0),
      tax: target.tax - recorded.reduce((sum, r) => sum + r.tax, 0),
    };
  });
}

/**
 * Gespeicherter Anteil einer Zahlung bzw. Ausbuchung, wenn er zur Rechnung passt: dieselben Steuersätze und zusammen der
 * Betrag; sonst aus dem Betrag gerechnet (ältere Zeilen ohne Anteil, wie gebucht). Für welche Rechnung er gerechnet ist,
 * prüft der Aufrufer (tax_shares_invoice_id), damit der Abgleich eine umgehängte Zahlung weiter als Abweichung meldet.
 */
export function recordedTaxShares(totals: InvoiceTotals, amount: Cents, stored: TaxShare[] | null | undefined): TaxShare[] {
  const computed = paidTaxShares(totals, amount);
  if (!stored) return computed;
  const fits =
    stored.length === computed.length &&
    computed.every((c) => stored.some((s) => s.rate === c.rate)) &&
    stored.reduce((sum, s) => sum + s.base + s.tax, 0) === amount;
  return fits ? stored : computed;
}

/** Zeilen ohne Betrag fallen weg, außer sie tragen eine Bemessungsgrundlage (Anteil ohne Steuer bei Ist) */
const mitBetragOderBasis = (line: PostingLine) => line.debit !== 0 || line.credit !== 0 || (line.basis ?? 0) !== 0;

/** Steuerbehandlungen, deren Bemessungsgrundlage bei Ist-Versteuerung mit der Zahlung gemeldet wird (DATEV-Dok. 1080673) */
const IST_MIT_ZAHLUNG: readonly TaxTreatment[] = ["regulaer", "steuerfrei", "ausfuhr"];

/**
 * Bei Ist-Versteuerung der Teil einer Zahlung (oder Kursdifferenz) für die Voranmeldung: je Satz die Umbuchung von
 * „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ mit der Bemessungsgrundlage an der Umsatzsteuerzeile; den Anteil zu 0 %
 * trägt die Forderungszeile mit Steuerschlüssel und Bemessungsgrundlage (#542).
 */
function istZahlungsanteil(lines: PostingLine[], shares: TaxShare[], kontenrahmen: Kontenrahmen, treatment: TaxTreatment): void {
  const accounts = ACCOUNTS[kontenrahmen];
  const meldet = IST_MIT_ZAHLUNG.includes(treatment);
  for (const { rate, base, tax } of shares) {
    if (rate === 0) {
      const forderung = lines.find((l) => l.account === accounts.forderungen);
      if (meldet && forderung && base !== 0) Object.assign(forderung, { taxCode: revenueTaxCode(0, treatment), basis: base });
      continue;
    }
    const code = revenueTaxCode(rate);
    if (tax !== 0) lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, true, code));
    // Gerundet ohne Steuer: eine Umsatzsteuerzeile ohne Betrag, nur mit Steuerschlüssel und Bemessungsgrundlage
    if (tax !== 0 || (meldet && base !== 0)) lines.push({ ...side(accounts.ust[vatRate(rate)], tax, false, code), ...(meldet ? { basis: base } : {}) });
  }
}

/**
 * Zahlungseingang auf eine Rechnung: Bank an Forderungen. Bei Ist-Versteuerung wird der
 * Steueranteil der Zahlung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ umgebucht; die Zahlung trägt dabei die
 * Bemessungsgrundlage des bezahlten Anteils (istZahlungsanteil).
 */
export function invoicePaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  shares: TaxShare[] = paidTaxShares(totals, paid),
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.bank, paid, true, null), side(accounts.forderungen, paid, false, null)];
  if (versteuerung === "ist") istZahlungsanteil(lines, shares, kontenrahmen, treatment);
  return lines.filter(mitBetragOderBasis);
}

/**
 * Bareinnahme auf eine Rechnung im Kassenbuch: wie der Zahlungseingang über die Bank, nur Kasse an Forderungen. Bei
 * Ist-Versteuerung wird die Umsatzsteuer so mit der Bareinnahme fällig (§ 13 Abs. 1 Nr. 1 Buchst. b UStG: mit Ablauf des
 * Voranmeldungszeitraums, in dem das Entgelt vereinnahmt ist). Negativ: Storno der Bareinnahme.
 */
export function invoiceCashPaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  shares: TaxShare[] = paidTaxShares(totals, paid),
  treatment: TaxTreatment = "regulaer",
): PostingLine[] {
  const { bank, kasse } = ACCOUNTS[kontenrahmen];
  return invoicePaymentPosting(totals, paid, kontenrahmen, versteuerung, shares, treatment).map((l) => (l.account === bank ? { ...l, account: kasse } : l));
}

/**
 * Verrechnungskonto eines Zahlungsdienstleisters (Guthaben bei PayPal, Stripe …): SKR03 1361–1369, SKR04 1461–1469,
 * neben dem Geldtransitkonto. Nummer 1 bis 9 je Dienstleister.
 */
export function paymentProviderAccount(kontenrahmen: Kontenrahmen, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 9) throw new RangeError(`Verrechnungskonto ${index} gibt es nicht`);
  return `${kontenrahmen === "SKR03" ? "136" : "146"}${index}`;
}

/**
 * Ausbuchung des Rests einer Rechnung oder eines Belegs: § 17 UStG (Entgelt hat sich geändert bzw. ist uneinbringlich)
 * oder die Kursdifferenz einer Zahlung auf eine Rechnung bzw. einen Beleg in Fremdwährung (ohne Umsatzsteuer)
 */
export const WRITE_OFF_KINDS = {
  skonto: "Skonto gewährt",
  forderungsausfall: "Forderungsausfall",
  skontoErhalten: "Skonto erhalten",
  kursdifferenz: "Kursdifferenz",
} as const;

export type WriteOffKind = keyof typeof WRITE_OFF_KINDS;

/**
 * Rest einer Rechnung ausbuchen, amount mit dem Vorzeichen einer Zahlung (Rechnung positiv): Erlösschmälerung
 * bzw. Forderungsverlust und Umsatzsteuer an Forderungen, je Steuersatz anteilig wie bei einer Teilzahlung.
 * Die Umsatzsteuer mindert sich bei Soll-Versteuerung auf dem Umsatzsteuerkonto, bei Ist auf „nicht fällig“,
 * denn fällig wird dort nur, was bezahlt wird.
 */
export function invoiceWriteOffPosting(
  kind: "skonto" | "forderungsausfall",
  totals: InvoiceTotals,
  amount: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
  treatment: TaxTreatment = "regulaer",
  shares: TaxShare[] = paidTaxShares(totals, amount),
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const expense = kind === "skonto" ? accounts.skontiGewaehrt : accounts.forderungsverluste;
  const lines: PostingLine[] = [side(accounts.forderungen, amount, false, null)];
  for (const { rate, base, tax } of shares) {
    const code = revenueTaxCode(rate, treatment);
    if (base !== 0) lines.push(side(expense, base, true, code));
    if (tax !== 0) lines.push(side((versteuerung === "ist" ? accounts.ustNichtFaellig : accounts.ust)[vatRate(rate)], tax, true, code));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

export { documentWriteOffPosting } from "./document-write-off.ts";

/**
 * Eine Seite einer Verrechnung zweier Belege ohne Zahlung (#274, #786): Die Seite bucht ihren Anteil aus dem offenen
 * Posten aus, Verbindlichkeiten gegen das Verrechnungskonto (SKR03 1590, SKR04 1370). `amount` trägt das Vorzeichen der
 * Zeile in `document_settlements`: negativ bei der Rechnung, deren Verbindlichkeit sinkt (Soll Verbindlichkeiten), positiv
 * bei der Gutschrift, deren Soll-Saldo sinkt (Haben Verbindlichkeiten). Zusammen mit der Buchung der anderen Seite steht
 * das Verrechnungskonto auf null. Ohne Steuerzeile: Die Vorsteuer einer Gutschrift „erstattet bereits Bezahltes“ zieht
 * erst die Umbuchung beim Ausgleich um (vorsteuerAusgleichPosting). Gebucht wird je Belegseite, damit jeder Vorgang seinen
 * Beleg trägt und der DATEV-Export das Personenkonto bilden kann.
 */
export function verrechnungPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.verbindlichkeiten, -amount, true, null), side(accounts.verrechnung, amount, true, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Umbuchung beim Ausgleich einer Gutschrift, die bereits Bezahltes erstattet (#786): Der Anteil, der beim Buchen auf dem
 * Zwischenkonto stand, geht auf das Vorsteuerkonto, mit Steuerschlüssel und Bemessungsgrundlage, damit Kz 66 die
 * Minderung genau dann sieht. `shares` sind die Anteile des Ausgleichs in der Richtung der Berichtigung: bei einer
 * Gutschrift positiv, also Soll Zwischenkonto / Haben Vorsteuer; eine Gegenbuchung dreht beide Seiten (reverseLines).
 * Sätze ohne Steuer (0 %) bleiben weg, sie haben nichts auf dem Zwischenkonto.
 */
export function vorsteuerAusgleichPosting(shares: readonly TaxShare[], kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  for (const { rate, base, tax } of shares) {
    // Auch der Rundungsrest einer 0 %-Zeile bleibt weg: Sie hat kein eigenes Konto (vatRate lehnt 0 ab), und die
    // letzte Umbuchung zieht den Rest ohnehin nach, weil sie gegen das Journal fortschreibt
    if (rate === 0 || tax === 0) continue;
    const code = inputTaxCode(rate);
    lines.push({ ...side(accounts.vorsteuerNochNichtAbziehbar, tax, true, code), basis: base });
    lines.push(side(accounts.vorsteuer[vatRate(rate)], tax, false, code));
  }
  return lines;
}

/**
 * Kursdifferenz beim Ausgleich einer Rechnung bzw. eines Belegs in Fremdwährung: Der Rest (amount mit dem Vorzeichen einer
 * Zahlung, Rechnung positiv, Beleg negativ) wird gegen Aufwand oder Ertrag aus Kursdifferenzen ausgebucht. Die Umsatzsteuer
 * ändert sich nicht, sie bleibt beim Kurs der Rechnung. Bei Ist-Versteuerung wird die Steuer auf den ausgebuchten Teil
 * einer Rechnung trotzdem fällig, sonst bliebe sie auf „nicht fällig“ stehen.
 */
export function exchangeDifferencePosting(
  target: { kind: "invoice"; totals: InvoiceTotals; versteuerung: Versteuerung; shares?: TaxShare[]; treatment?: TaxTreatment } | { kind: "document" },
  amount: Cents,
  kontenrahmen: Kontenrahmen,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  if (target.kind === "invoice") {
    // Weniger erhalten als die Forderung in Euro: Aufwand; mehr (negativer Rest): Ertrag
    lines.push(side(accounts.forderungen, amount, false, null), side(amount > 0 ? accounts.kursAufwand : accounts.kursErtrag, amount, true, null));
    if (target.versteuerung === "ist") {
      istZahlungsanteil(lines, target.shares ?? paidTaxShares(target.totals, amount), kontenrahmen, target.treatment ?? "regulaer");
    }
    return lines.filter(mitBetragOderBasis);
  } else {
    // Rest einer Verbindlichkeit (Ausgang negativ): weniger gezahlt ist Ertrag, mehr gezahlt Aufwand
    lines.push(side(accounts.verbindlichkeiten, -amount, true, null), side(amount < 0 ? accounts.kursErtrag : accounts.kursAufwand, -amount, false, null));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Kursdifferenz als Teil eines Bankumsatzes (Zahlung über dem offenen Betrag): Bank an Ertrag bzw. Aufwand an Bank */
export function exchangeDifferenceBankPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.bank, amount, true, null), side(amount > 0 ? accounts.kursErtrag : accounts.kursAufwand, amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Zahlung eines gebuchten Belegs: Verbindlichkeiten an Bank (amount wie auf dem Konto, Ausgang negativ). */
export function documentPaymentPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.verbindlichkeiten, -amount, true, null), side(accounts.bank, amount, true, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Bankumsätze ohne Rechnung oder Beleg */
export const DIRECT_BOOKINGS = {
  privat: "Privat (Entnahme oder Einlage)",
  // Entnahme auf ein eigenes Privatkonto, damit die Summe für die Sonderausgaben (§ 10b EStG) im Journal steht
  spende: "Spende (privat, Sonderausgabe)",
  geldtransit: "Geldtransit (eigenes Konto)",
  ustVorauszahlung: "Umsatzsteuer an das Finanzamt",
  sondervorauszahlung: "Sondervorauszahlung (Dauerfristverlängerung)",
  gebuehren: "Kontoführung und Bankgebühren",
  mahnerloes: "Mahngebühren und Verzugszinsen (vom Kunden)",
  // Bruttozins; einbehaltene Kapitalertragsteuer als eigener Teil einer Aufteilung (Steuerzahlung, steuerzahlung.ts)
  zinsertrag: "Zinserträge (Guthabenzinsen auf ein betriebliches Konto)",
  kapest: "Kapitalertragsteuer an das Finanzamt (Ausschüttung)",
  // Zahlungen aus der Lohnabrechnung, gegen die Verbindlichkeiten ihrer Buchung (lohn-buchung.ts)
  lohn: "Lohn/Gehalt an Mitarbeiter",
  lohnsteuer: "Lohnsteuer an das Finanzamt",
  sozialversicherung: "SV-Beiträge an Krankenkasse oder Minijob-Zentrale",
} as const;

/** Buchungen ohne Beleg, die eine Verbindlichkeit aus der Lohnabrechnung bezahlen; in der EÜR Ausgaben für Personal */
export const LOHN_ZAHLUNGEN = ["lohn", "lohnsteuer", "sozialversicherung"] as const satisfies readonly (keyof typeof DIRECT_BOOKINGS)[];

export type LohnZahlung = (typeof LOHN_ZAHLUNGEN)[number];

export const isLohnZahlung = (kind: string): kind is LohnZahlung => (LOHN_ZAHLUNGEN as readonly string[]).includes(kind);

/** Verbindlichkeit, die eine Lohnzahlung tilgt */
export function lohnZahlungKonto(kind: LohnZahlung, kontenrahmen: Kontenrahmen): string {
  const k = LOHN_KONTEN[kontenrahmen];
  return kind === "lohn" ? k.verbLohn : kind === "lohnsteuer" ? k.verbLohnsteuer : k.verbSv;
}

export type DirectBooking = keyof typeof DIRECT_BOOKINGS;

/** Bezeichnung einer Buchung ohne Beleg; „privat“ heißt in GmbH und UG Gesellschafter-Verrechnungskonto */
export function directBookingLabel(kind: DirectBooking, rechtsform: Rechtsform): string {
  return kind === "privat" ? ownerLabels(rechtsform).bank : DIRECT_BOOKINGS[kind];
}

/**
 * Buchungen ohne Beleg, die es in der Rechtsform gibt: Ausschüttungen und ihre Kapitalertragsteuer nur in GmbH und UG, die
 * private Spende nur ohne GmbH und UG (deren Spenden sind Aufwand mit Abzug nach § 9 Abs. 1 Nr. 2 KStG)
 */
export function directBookingsFor(rechtsform: Rechtsform): DirectBooking[] {
  const gmbh = isKapitalgesellschaft(rechtsform);
  return (Object.keys(DIRECT_BOOKINGS) as DirectBooking[]).filter((kind) => (kind === "kapest" ? gmbh : kind === "spende" ? !gmbh : true));
}

export function directPosting(kind: DirectBooking, amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  if (!directBookingsFor(rechtsform).includes(kind)) {
    throw new Error(`${DIRECT_BOOKINGS[kind]} gibt es ${kind === "spende" ? "nicht in GmbH und UG" : "nur in GmbH und UG"}`);
  }
  const counter = isLohnZahlung(kind)
    ? lohnZahlungKonto(kind, kontenrahmen)
    : kind === "kapest"
      ? accounts.kapestEinbehalt
      : kind === "privat"
        ? ownerAccount(kontenrahmen, rechtsform, amount < 0 ? "entnahme" : "einlage")
        : kind === "spende"
          ? accounts.spenden
          : kind === "geldtransit"
            ? accounts.geldtransit
            : kind === "ustVorauszahlung"
              ? accounts.ustVorauszahlung
              : kind === "sondervorauszahlung"
                ? accounts.sondervorauszahlung
                : kind === "mahnerloes"
                  ? accounts.mahnerloes
                  : kind === "zinsertrag"
                    ? accounts.zinsertraege
                    : accounts.nebenkostenGeldverkehr;
  return [side(accounts.bank, amount, true, null), side(counter, amount, false, null)].filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Gegenkonto einer Zahlung, die über ein privates Konto läuft (#866): Ein Eingang fließt ins Private (Entnahme,
 * § 4 Abs. 1 Satz 2 EStG), ein Ausgang hat eine betriebliche Schuld aus privatem Geld bezahlt (Einlage). In GmbH
 * und UG steht dort in beiden Richtungen das Gesellschafter-Verrechnungskonto.
 */
export function privatZahlung(amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): string {
  return ownerAccount(kontenrahmen, rechtsform, amount > 0 ? "entnahme" : "einlage");
}

/**
 * Umsatzsteuer-Erstattung, die auf einem privaten Konto eingeht (#866): Die Forderung gegen das
 * Finanzamt wird erfüllt, das Geld fließt aber ins Private. Gebucht wird deshalb gegen die
 * Privatentnahme (SKR03 1800, SKR04 2100), in GmbH und UG gegen das Gesellschafter-Verrechnungskonto,
 * nicht gegen die Bank. Auf einem Geschäftskonto bleibt es bei directPosting.
 */
export function ustPrivatPosting(amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(privatZahlung(amount, kontenrahmen, rechtsform), amount, true, null), side(accounts.ustVorauszahlung, amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Kassenbuchungen ohne Beleg: Einlage und Entnahme, Geld von der Bank in die Kasse und zurück */
export const CASH_BOOKINGS = {
  einlage: { label: "Einlage", sign: 1, kind: "privat" },
  entnahme: { label: "Entnahme", sign: -1, kind: "privat" },
  abhebung: { label: "Abhebung von der Bank", sign: 1, kind: "geldtransit" },
  einzahlung: { label: "Einzahlung auf die Bank", sign: -1, kind: "geldtransit" },
} as const;

export type CashBooking = keyof typeof CASH_BOOKINGS;

/** Bezeichnung einer Kassenbuchung; Einlage und Entnahme heißen in GmbH und UG „Vom“ bzw. „An den Gesellschafter“ */
export function cashBookingLabel(kind: CashBooking, rechtsform: Rechtsform): string {
  const owner = ownerLabels(rechtsform);
  return kind === "einlage" ? owner.cashIn : kind === "entnahme" ? owner.cashOut : CASH_BOOKINGS[kind].label;
}

/** Art einer Zeile im Kassenbuch: bar bezahlter Beleg, Bareinnahme auf eine oder ohne Rechnung oder eine Kassenbuchung ohne Beleg */
export function cashEntryLabel(kind: CashBooking | "beleg" | "rechnung" | "einnahme" | "import", rechtsform: Rechtsform): string {
  if (kind === "import") return "Übernommene Kassenbewegung";
  if (kind === "beleg") return "Beleg";
  if (kind === "rechnung") return "Bareinnahme Rechnung";
  return kind === "einnahme" ? "Bareinnahme" : cashBookingLabel(kind, rechtsform);
}

/** Kasse an Privateinlage (bzw. Gesellschafter) oder Geldtransit; Ausgänge aus der Kasse (negativ) drehen die Seiten */
export function cashPosting(kind: "privat" | "geldtransit", amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const counter = kind === "geldtransit" ? accounts.geldtransit : ownerAccount(kontenrahmen, rechtsform, amount < 0 ? "entnahme" : "einlage");
  return [side(accounts.kasse, amount, true, null), side(counter, amount, false, null)].filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Eröffnungsbuchung für eine offene Rechnung aus der Vorgänger-Buchhaltung: Forderung an Saldenvortrag.
 * Die Erlöse stehen schon in den alten Büchern. Bei Ist-Versteuerung ist die Umsatzsteuer dort noch
 * nicht angemeldet; sie kommt auf „Umsatzsteuer nicht fällig“ und wird mit dem Zahlungseingang fällig.
 */
export function openingInvoicePosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  if (versteuerung === "ist") {
    for (const { rate, tax } of totals.taxes) {
      if (tax !== 0) lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    }
    lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  } else {
    lines.push(side(accounts.saldenvortrag, totals.gross, false, null));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Eröffnungsbuchung für einen offenen Eingangsbeleg: Saldenvortrag an Verbindlichkeiten. Vorsteuer ist schon angemeldet. */
export function openingDocumentPosting(gross: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.saldenvortrag, gross, true, null), side(accounts.verbindlichkeiten, gross, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/**
 * Storno oder Korrektur einer aus der Vorgänger-Buchhaltung übernommenen Rechnung (negative Summen).
 * Die Erlöse stehen in den alten Büchern, deshalb geht der Nettobetrag wie bei der Eröffnung gegen den
 * Saldenvortrag. Bei Soll mindert die Korrektur die dort schon angemeldete Umsatzsteuer, bei Ist die
 * noch nicht fällige.
 */
export function legacyCorrectionPosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, tax } of totals.taxes) {
    if (tax === 0) continue;
    if (versteuerung === "ist") lines.push(side(accounts.ustNichtFaellig[vatRate(rate)], tax, false, null));
    else lines.push(side(accounts.ust[vatRate(rate)], tax, false, revenueTaxCode(rate)));
  }
  if (versteuerung === "ist") {
    lines.push(side(accounts.saldenvortrag, totals.net, false, null));
  } else {
    // Soll: Die Voranmeldung meldet die Korrektur im Monat der Korrektur mit ihrer Bemessungsgrundlage (§ 17 UStG); je
    // Steuersatz eine Zeile mit Steuerschlüssel, damit das Journal sie trägt (#542). Bei Ist zählt die Erstattung.
    for (const { rate, base } of totals.taxes) lines.push(side(accounts.saldenvortrag, base, false, revenueTaxCode(rate)));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}
