import { finanzamtsnummer, type Cents, type UstvaFigures, type VatPeriod } from "@haben/core";

/** Hersteller-ID für Testübermittlungen laut ERiC-Dokumentation. */
export const TEST_HERSTELLER_ID = "74931";
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
  figures: Pick<UstvaFigures, "kz81" | "kz86" | "kz66" | "kz83"> & Partial<Pick<UstvaFigures, "kz21" | "kz45" | "kz48" | "kz46" | "kz47" | "kz84" | "kz85" | "kz67">>;
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
  const erklaerung = /<(E10|E50|E77)\b[^>]*\bversion="(\d{4})"/.exec(xml);
  if (erklaerung?.[1] && erklaerung[2]) return `${{ E10: "ESt", E50: "USt", E77: "EUER" }[erklaerung[1]]}_${erklaerung[2]}`;
  const nachricht = /<DatenArt>(SonstigeNachrichten)<\/DatenArt>[\s\S]*<Nachricht\b[^>]*\bversion="(\d+)"/.exec(xml);
  if (nachricht?.[1] && nachricht[2]) return `${nachricht[1]}_${nachricht[2]}`;
  const bank = /<AenderungBankverbindung\b[^>]*\bversion="(\d+)"/.exec(xml);
  if (bank?.[1]) return `AenderungBankverbindung_${bank[1]}`;
  const abholung = /<DatenArt>(PostfachAnfrage|PostfachBestaetigung)<\/DatenArt>[\s\S]*<Datenabholung\b[^>]*\bversion="(\d+)"/.exec(xml);
  if (abholung?.[1] && abholung[2]) return `${abholung[1]}_${abholung[2]}`;
  if (/<DatenArt>ElsterVaStDaten<\/DatenArt>/.test(xml)) return "ElsterVaStDaten";
  // Berechtigungsmanagement: Datenart = Datenart-Version
  const brm = /<DatenArt>(SpezRecht(?:Antrag|Freischaltung|Storno|Liste))<\/DatenArt>/.exec(xml);
  if (brm?.[1]) return brm[1];
  return undefined;
}

/**
 * Trägt das XML irgendeinen Testmerker? Haben setzt 700000004 (Anmeldungen, Erklärungen, Nachrichten,
 * Postfach) und 370000001 (Belegabruf, Berechtigungsmanagement); jeder andere Wert gilt ebenso als Test.
 */
export function hasTestmerker(xml: string): boolean {
  return /<Testmerker>\s*[^<\s][^<]*<\/Testmerker>/.test(xml);
}

/** Fehlermeldung, wenn Testmerker im XML und angeforderte Übermittlungsart nicht zusammenpassen */
export function testmerkerMismatch(xml: string, test: boolean): string | undefined {
  if (hasTestmerker(xml) === test) return undefined;
  return test
    ? "Testübermittlung angefordert, aber das XML trägt keinen Testmerker."
    : "Echte Übermittlung angefordert, aber das XML trägt einen Testmerker.";
}

/** Maskiert für Text und Attribute; in XML 1.0 unzulässige Steuerzeichen fallen weg (sonst Parserfehler in ERiC) */
export function escapeXml(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function checkSteuernummer13(steuernummer13: string): void {
  if (!/^\d{13}$/.test(steuernummer13)) throw new Error(`Steuernummer muss 13-stellig im ELSTER-Format sein: ${steuernummer13}`);
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

export interface TransferKopf {
  verfahren: string;
  datenArt: string;
  /** Fehlt bei Echtfällen */
  testmerker: string | undefined;
  /** Bundesland als Ziel im TransferHeader (ElsterErklaerung, ElsterNachricht) */
  ziel?: string;
  herstellerId: string;
  datenlieferant: string;
}

export interface Nutzdatenblock {
  ticket: string;
  /** F: Finanzamtsnummer, L: Clearingstelle (CS) */
  empfaenger: { id: "F" | "L"; wert: string };
  /** Ohne Produktversion entfällt der Hersteller-Block */
  produktVersion?: string;
  nutzdaten: string[];
}

/** ELSTER-Umschlag: TransferHeader und je Block NutzdatenHeader um die fertigen Nutzdaten */
export function elsterXml(kopf: TransferKopf, bloecke: Nutzdatenblock[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    element("Verfahren", kopf.verfahren),
    element("DatenArt", kopf.datenArt),
    element("Vorgang", "send-Auth"),
    ...(kopf.testmerker ? [element("Testmerker", kopf.testmerker)] : []),
    ...(kopf.ziel !== undefined ? [`<Empfaenger id="L">${element("Ziel", kopf.ziel)}</Empfaenger>`] : []),
    element("HerstellerID", kopf.herstellerId),
    element("DatenLieferant", kopf.datenlieferant),
    `<Datei>`,
    element("Verschluesselung", "CMSEncryptedData"),
    element("Kompression", "GZIP"),
    `<TransportSchluessel></TransportSchluessel>`,
    `</Datei>`,
    `</TransferHeader>`,
    `<DatenTeil>`,
    ...bloecke.flatMap((block) => [
      `<Nutzdatenblock>`,
      `<NutzdatenHeader version="11">`,
      element("NutzdatenTicket", block.ticket),
      `<Empfaenger id="${block.empfaenger.id}">${escapeXml(block.empfaenger.wert)}</Empfaenger>`,
      ...(block.produktVersion !== undefined
        ? [`<Hersteller>`, element("ProduktName", PRODUKT_NAME), element("ProduktVersion", block.produktVersion), `</Hersteller>`]
        : []),
      `</NutzdatenHeader>`,
      `<Nutzdaten>`,
      ...block.nutzdaten,
      `</Nutzdaten>`,
      `</Nutzdatenblock>`,
    ]),
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}

export function buildUstvaXml(input: UstvaXmlInput): string {
  const { period, figures, datenlieferant: dl } = input;
  checkSteuernummer13(input.steuernummer13);
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new RangeError(`Ungültiger Monat: ${period.month}`);
  }

  // Kennzahlen in aufsteigender Reihenfolge, wie im Schema
  const kennzahlen: string[] = [];
  const base = (kz: string, cents: Cents | undefined) => {
    if (cents !== undefined && Math.trunc(cents / 100) !== 0) kennzahlen.push(element(`Kz${kz}`, wholeEuros(cents)));
  };
  if (input.berichtigt) kennzahlen.push(element("Kz10", "1"));
  const tax = (kz: string, cents: Cents | undefined) => {
    if (cents !== undefined && cents !== 0) kennzahlen.push(element(`Kz${kz}`, elsterDecimal(cents)));
  };
  base("21", figures.kz21);
  base("45", figures.kz45);
  base("46", figures.kz46);
  tax("47", figures.kz47);
  base("48", figures.kz48);
  tax("66", figures.kz66);
  tax("67", figures.kz67);
  base("81", figures.kz81);
  kennzahlen.push(element("Kz83", elsterDecimal(figures.kz83)));
  base("84", figures.kz84);
  tax("85", figures.kz85);
  base("86", figures.kz86);

  const lieferantKurz = `${dl.name}, ${dl.strasse}, ${dl.plz} ${dl.ort}`;

  return elsterXml(
    { verfahren: "ElsterAnmeldung", datenArt: "UStVA", testmerker: input.test ? TESTMERKER : undefined, herstellerId: input.herstellerId, datenlieferant: lieferantKurz },
    [
      {
        ticket: "1",
        empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) },
        produktVersion: input.produktVersion,
        nutzdaten: [
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
        ],
      },
    ],
  );
}
