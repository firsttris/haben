import { finanzamtsnummer, type Cents, type UstvaFigures, type VatPeriod } from "@haben/core";

/** Hersteller-ID und Bundesfinanzamt für Testübermittlungen laut ERiC-Dokumentation. */
export const TEST_HERSTELLER_ID = "74931";
export const TEST_STEUERNUMMER_BUFA = "9198";
/** Testmerker für Testfälle, die der Server annimmt, aber nicht weiterleitet. */
export const TESTMERKER = "700000004";
export const PRODUKT_NAME = "Haben";

export interface Datenlieferant {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
}

export interface UstvaXmlInput {
  period: VatPeriod;
  /** 13-stellige Steuernummer im ELSTER-Format */
  steuernummer13: string;
  figures: Pick<UstvaFigures, "kz81" | "kz86" | "kz66" | "kz83"> & Partial<Pick<UstvaFigures, "kz21" | "kz45" | "kz48">>;
  datenlieferant: Datenlieferant;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
  /** Berichtigte Anmeldung (Kz 10) */
  berichtigt?: boolean;
  erstellungsdatum?: Date;
}

/** Datenart-Version, die ERiC zum XML erwartet. */
export function ustvaDatenartVersion(year: number): string {
  return `UStVA_${year}`;
}

/** Liest die Datenart-Version aus dem XML (für validate/send ohne Zusatzangaben): UStVA_2026, USt_2025, EUER_2025 */
export function datenartVersionFromXml(xml: string): string | undefined {
  const ustva = /<Anmeldungssteuern\b[^>]*\bversion="(\d{4})"/.exec(xml);
  if (ustva?.[1]) return ustvaDatenartVersion(Number(ustva[1]));
  const erklaerung = /<(E50|E77)\b[^>]*\bversion="(\d{4})"/.exec(xml);
  if (erklaerung?.[1] && erklaerung[2]) return `${erklaerung[1] === "E50" ? "USt" : "EUER"}_${erklaerung[2]}`;
  return undefined;
}

export function hasTestmerker(xml: string): boolean {
  return /<Testmerker>\s*700000004\s*<\/Testmerker>/.test(xml);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Bemessungsgrundlage in vollen Euro: 123456 → "1234" */
export function wholeEuros(cents: Cents): string {
  return String(Math.trunc(cents / 100));
}

/** Betrag mit Komma, ohne Tausenderpunkte: -1200 → "-12,00" */
export function elsterDecimal(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Kein ganzzahliger Centbetrag: ${cents}`);
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${euros},${rest}`;
}

function yyyymmdd(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${mm}${dd}`;
}

function element(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

export function buildUstvaXml(input: UstvaXmlInput): string {
  const { period, figures, datenlieferant: dl } = input;
  if (!/^\d{13}$/.test(input.steuernummer13)) {
    throw new Error(`Steuernummer muss 13-stellig im ELSTER-Format sein: ${input.steuernummer13}`);
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new RangeError(`Ungültiger Monat: ${period.month}`);
  }

  // Kennzahlen in aufsteigender Reihenfolge, wie im Schema
  const kennzahlen: string[] = [];
  const base = (kz: string, cents: Cents | undefined) => {
    if (cents !== undefined && Math.trunc(cents / 100) !== 0) kennzahlen.push(element(`Kz${kz}`, wholeEuros(cents)));
  };
  if (input.berichtigt) kennzahlen.push(element("Kz10", "1"));
  base("21", figures.kz21);
  base("45", figures.kz45);
  base("48", figures.kz48);
  if (figures.kz66 !== 0) kennzahlen.push(element("Kz66", elsterDecimal(figures.kz66)));
  base("81", figures.kz81);
  kennzahlen.push(element("Kz83", elsterDecimal(figures.kz83)));
  base("86", figures.kz86);

  const lieferantKurz = `${dl.name}, ${dl.strasse}, ${dl.plz} ${dl.ort}`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    element("Verfahren", "ElsterAnmeldung"),
    element("DatenArt", "UStVA"),
    element("Vorgang", "send-Auth"),
    ...(input.test ? [element("Testmerker", TESTMERKER)] : []),
    element("HerstellerID", input.herstellerId),
    element("DatenLieferant", lieferantKurz),
    `<Datei>`,
    element("Verschluesselung", "CMSEncryptedData"),
    element("Kompression", "GZIP"),
    `<TransportSchluessel></TransportSchluessel>`,
    `</Datei>`,
    `</TransferHeader>`,
    `<DatenTeil>`,
    `<Nutzdatenblock>`,
    `<NutzdatenHeader version="11">`,
    element("NutzdatenTicket", "1"),
    `<Empfaenger id="F">${escapeXml(finanzamtsnummer(input.steuernummer13))}</Empfaenger>`,
    `<Hersteller>`,
    element("ProduktName", PRODUKT_NAME),
    element("ProduktVersion", input.produktVersion),
    `</Hersteller>`,
    `</NutzdatenHeader>`,
    `<Nutzdaten>`,
    `<Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v${period.year}" art="UStVA" version="${period.year}">`,
    `<DatenLieferant>`,
    element("Name", dl.name),
    element("Strasse", dl.strasse),
    element("PLZ", dl.plz),
    element("Ort", dl.ort),
    `</DatenLieferant>`,
    element("Erstellungsdatum", yyyymmdd(input.erstellungsdatum ?? new Date())),
    `<Steuerfall>`,
    `<Umsatzsteuervoranmeldung>`,
    element("Jahr", String(period.year)),
    element("Zeitraum", String(period.month).padStart(2, "0")),
    element("Steuernummer", input.steuernummer13),
    ...kennzahlen,
    `</Umsatzsteuervoranmeldung>`,
    `</Steuerfall>`,
    `</Anmeldungssteuern>`,
    `</Nutzdaten>`,
    `</Nutzdatenblock>`,
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}
