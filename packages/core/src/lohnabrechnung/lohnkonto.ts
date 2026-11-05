import { type Cents, toCsv } from "../money.ts";

/*
 * Lohnkonto je Arbeitnehmer und Kalenderjahr (§ 41 Abs. 1 EStG, https://www.gesetze-im-internet.de/estg/__41.html),
 * mit den Einzelangaben aus § 4 LStDV (https://www.gesetze-im-internet.de/lstdv/__4.html):
 * - Abs. 1 Nr. 1: Vorname, Familienname, Tag der Geburt, Wohnort, Wohnung und die allgemeinen Besteuerungsmerkmale;
 *   ändern sie sich im Jahr, auch ab wann. Haben hält die Merkmale je Abrechnung fest, die Änderung steht so in der Zeile.
 * - Abs. 2 Nr. 1 und 3: je Lohnabrechnung Tag der Lohnzahlung, Lohnzahlungszeitraum, Arbeitslohn (Barlohn; Sachbezüge
 *   rechnet Haben nicht) und die einbehaltene Lohnsteuer; dazu Soli und Kirchensteuer.
 * - Abs. 2 Nr. 4: steuerfreie Bezüge; Haben rechnet keine, die Spalte bleibt 0.
 * - Abs. 2 Nr. 8: pauschal besteuerte Bezüge (§ 40a Abs. 2 EStG, Minijob) und die Pauschsteuer.
 * Freibeträge (Nr. 2), Freistellungsbescheinigungen (Nr. 3), Versorgungsbezüge (Nr. 4) und der Großbuchstabe U
 * (Abs. 2 Nr. 2) kommen in den Fällen, die Haben abrechnet, nicht vor.
 * Aufbewahren bis zum Ablauf des sechsten Kalenderjahres nach der letzten eingetragenen Lohnzahlung (§ 41 Abs. 1 Satz 9 EStG).
 */

export interface LohnkontoMitarbeiter {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  /** Wohnung und Wohnort */
  anschrift: string[];
  steuerId: string;
  personalnummer: string;
  eintritt: string;
  austritt: string | null;
  /** Merkmale zum Zeitpunkt der Ausgabe, etwa „Steuerklasse I, Kinderfreibeträge 0, evangelisch“ */
  merkmale: string;
  /** Sozialversicherung, etwa „Gesellschafter-Geschäftsführer ohne SV-Pflicht“ oder „TK, Beitragsgruppen 1111“ */
  sozialversicherung: string;
}

export interface LohnkontoZeile {
  /** Tag der Lohnzahlung, bei einem Storno der Tag des Stornos */
  zahltag: string;
  /** Lohnzahlungszeitraum: Monat 1 bis 12 */
  monat: number;
  storno: boolean;
  /** Besteuerungsmerkmale, mit denen abgerechnet wurde */
  merkmale: string;
  brutto: Cents;
  steuerBrutto: Cents;
  steuerfrei: Cents;
  pauschalBrutto: Cents;
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  pauschsteuer: Cents;
  svArbeitnehmer: Cents;
  svArbeitgeber: Cents;
  netto: Cents;
}

type Betraege = Omit<LohnkontoZeile, "zahltag" | "monat" | "storno" | "merkmale">;

export interface Lohnkonto {
  jahr: number;
  mitarbeiter: LohnkontoMitarbeiter;
  zeilen: LohnkontoZeile[];
  summe: Betraege;
  /** Ende der Aufbewahrung, JJJJ-MM-TT; null ohne Lohnzahlung */
  aufbewahrenBis: string | null;
}

const BETRAEGE: (keyof Betraege)[] = [
  "brutto",
  "steuerBrutto",
  "steuerfrei",
  "pauschalBrutto",
  "lohnsteuer",
  "soli",
  "kirchensteuer",
  "pauschsteuer",
  "svArbeitnehmer",
  "svArbeitgeber",
  "netto",
];

/** Zeilen nach Zahltag; ein Storno steht mit negativen Beträgen als eigene Zeile darin */
export function lohnkonto(jahr: number, mitarbeiter: LohnkontoMitarbeiter, zeilen: readonly LohnkontoZeile[]): Lohnkonto {
  const sortiert = [...zeilen].sort((a, b) => a.zahltag.localeCompare(b.zahltag) || a.monat - b.monat || Number(a.storno) - Number(b.storno));
  const summe = Object.fromEntries(BETRAEGE.map((k) => [k, sortiert.reduce((s, z) => s + z[k], 0)])) as unknown as Betraege;
  const letzte = sortiert.at(-1)?.zahltag;
  return { jahr, mitarbeiter, zeilen: sortiert, summe, aufbewahrenBis: letzte ? `${Number(letzte.slice(0, 4)) + 6}-12-31` : null };
}

const SPALTEN = [
  "Tag der Zahlung",
  "Zeitraum",
  "Art",
  "Merkmale",
  "Bruttoarbeitslohn",
  "Steuerpflichtig",
  "Steuerfrei",
  "Pauschal besteuert",
  "Lohnsteuer",
  "Solidaritätszuschlag",
  "Kirchensteuer",
  "Pauschsteuer",
  "SV Arbeitnehmer",
  "SV Arbeitgeber",
  "Netto",
];

const datum = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Lohnkonto als CSV (Semikolon, Dezimalkomma): Kopf mit den Angaben zur Person, dann je Zahlung eine Zeile und die Summe */
export function lohnkontoCsv(k: Lohnkonto): string {
  const m = k.mitarbeiter;
  const kopf: string[][] = [
    ["Lohnkonto", String(k.jahr)],
    ["Name", `${m.nachname}, ${m.vorname}`],
    ["Personalnummer", m.personalnummer],
    ["Geburtsdatum", datum(m.geburtsdatum)],
    ["Anschrift", m.anschrift.join(", ")],
    ["Steuer-ID", m.steuerId],
    ["Besteuerungsmerkmale", m.merkmale],
    ["Sozialversicherung", m.sozialversicherung],
    ["Eintritt", datum(m.eintritt)],
    ["Austritt", m.austritt ? datum(m.austritt) : ""],
    [],
  ];
  const zeilen = k.zeilen.map((z) => [
    datum(z.zahltag),
    `${String(z.monat).padStart(2, "0")}/${k.jahr}`,
    z.storno ? "Storno" : "Abrechnung",
    z.merkmale,
    ...BETRAEGE.map((b) => z[b]),
  ]);
  return toCsv([...kopf, SPALTEN, ...zeilen, ["Summe", "", "", "", ...BETRAEGE.map((b) => k.summe[b])]]);
}
