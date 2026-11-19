import { finanzamtsnummer, type Cents } from "@haben/core";
import { checkSteuernummer13, elsterDecimal, ElsterEingabeError, elsterXml, escapeXml, PRODUKT_NAME, TESTMERKER } from "./xml.ts";

/**
 * Jahreserklärungen im Verfahren ElsterErklaerung: hier das gemeinsame Gerüst (Vorsatz, Envelope,
 * XmlNode, render, amount). Die Anlage EÜR mit Anlage AVEÜR (E77, Datenart EUER) liegt in
 * euer-erklaerung.ts, die Umsatzsteuererklärung (E50) in ust-erklaerung.ts.
 *
 * Feldkennungen und Reihenfolge stammen aus Implementierungen, die damit erfolgreich an ELSTER
 * übermitteln (EasyCash&Tax ECTElster, viking, finamt); die amtliche Quelle ist die
 * Jahresdokumentation im ERiC-Paket. Das Finanzamt ändert die Vordrucke jährlich; vor dem
 * Echtversand prüft ERiC jedes XML gegen das Schema des Jahres (Prüfen bzw. Testübermittlung).
 */

/** Ab diesem Jahr gilt die Struktur mit den Tabelle-Elementen (E50) */
export const ERSTES_ERKLAERUNGSJAHR = 2023;

/** Element mit Text, mit Kindelementen oder weggelassen (undefined bzw. ohne Kinder) */
export type XmlNode = readonly [name: string, content: string | readonly (XmlNode | null | undefined | false)[] | undefined];

export function render(node: XmlNode | null | undefined | false, indent: string): string[] {
  if (!node) return [];
  const [name, content] = node;
  if (content === undefined) return [];
  if (typeof content === "string") return [`${indent}<${name}>${escapeXml(content)}</${name}>`];
  const children = content.flatMap((child) => render(child, `${indent}  `));
  if (children.length === 0) return [];
  return [`${indent}<${name}>`, ...children, `${indent}</${name}>`];
}

/** Betrag mit Cent, leer bei 0 (das Feld entfällt dann) */
export const amount = (cents: Cents | undefined): string | undefined => (cents ? elsterDecimal(cents) : undefined);

/** TT.MM.JJJJ */

export interface ErklaerungAbsender {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
}

export interface Envelope {
  datenArt: "USt" | "EUER" | "ESt" | "GewSt" | "KSt";
  year: number;
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BW"; Empfänger im TransferHeader */
  bundesland: string;
  absender: ErklaerungAbsender;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

export function checkEnvelope(input: Envelope) {
  checkSteuernummer13(input.steuernummer13);
  if (!Number.isInteger(input.year) || input.year < ERSTES_ERKLAERUNGSJAHR) {
    throw new ElsterEingabeError(`Jahreserklärungen gehen ab ${ERSTES_ERKLAERUNGSJAHR}, nicht für ${input.year}.`);
  }
  if (!/^[A-Z]{2}$/.test(input.bundesland)) throw new ElsterEingabeError(`Bundesland fehlt: ${input.bundesland}`);
}

/** Identifikationsnummern stehen bei der Einkommensteuer im Vorsatz, nicht in den Personendaten */
export function vorsatz(unterfallart: "10" | "20" | "30" | "50" | "77", input: Envelope, idnr?: { a: string; b?: string }): XmlNode {
  const a = input.absender;
  return [
    "Vorsatz",
    [
      ["Unterfallart", unterfallart],
      ["Vorgang", "01"],
      ["StNr", input.steuernummer13],
      ["ID", idnr?.a],
      ["IDEhefrau", idnr?.b],
      ["Zeitraum", String(input.year)],
      ["AbsName", a.name.slice(0, 45)],
      ["AbsStr", a.strasse.slice(0, 30)],
      ["AbsPlz", a.plz],
      ["AbsOrt", a.ort.slice(0, 29)],
      ["Copyright", PRODUKT_NAME],
      ["OrdNrArt", "S"],
      // 2 = kein elektronischer Bescheid über diesen Weg; der Bescheid kommt wie gewohnt
      ["Rueckuebermittlung", [["Bescheid", "2"]]],
    ],
  ];
}

export function envelope(input: Envelope, nutzdaten: string[]): string {
  const a = input.absender;
  return elsterXml(
    {
      verfahren: "ElsterErklaerung",
      datenArt: input.datenArt,
      testmerker: input.test ? TESTMERKER : undefined,
      ziel: input.bundesland,
      herstellerId: input.herstellerId,
      datenlieferant: `${a.name}, ${a.strasse}, ${a.plz} ${a.ort}`,
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) }, produktVersion: input.produktVersion, nutzdaten }],
  );
}
