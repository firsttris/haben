import { dueDate } from "./period.ts";
import type { Bundesland } from "./steuernummer.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen } from "./posting.ts";
import { VORTRAG_ACCOUNTS } from "./vortrag.ts";

/*
 * Gewinnausschüttung einer GmbH oder UG an ihre Gesellschafter: Kapitalertragsteuer, Solidaritätszuschlag und
 * Kirchensteuer, die die Gesellschaft einbehält (§ 43 Abs. 1 Satz 1 Nr. 1, § 43a Abs. 1, § 44 EStG), und die Buchung
 * des Gewinnverwendungsbeschlusses. Konten aus dem DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175).
 *
 * Ausgezahlt wird die Nettodividende über das Gesellschafter-Verrechnungskonto (Bankabgleich „An Gesellschafter“), die
 * einbehaltenen Steuern gehen mit der Kapitalertragsteuer-Anmeldung an das Finanzamt.
 */

/** Kirchensteuersatz in Prozent: 8 in Bayern und Baden-Württemberg, 9 sonst; 0 ohne Kirchensteuerabzug */
export type KirchensteuerSatz = 0 | 8 | 9;

export interface Abzug {
  kapest: Cents;
  soli: Cents;
  kist: Cents;
}

/**
 * Steuerabzug auf einen Kapitalertrag: 25 % Kapitalertragsteuer, mit Kirchensteuer ermäßigt auf e / (4 + k)
 * (§ 43a Abs. 1 Satz 2 in Verbindung mit § 32d Abs. 1 Satz 4 EStG), Solidaritätszuschlag 5,5 % und Kirchensteuer k %
 * der Kapitalertragsteuer. Bruchteile eines Cents bleiben außer Ansatz.
 */
export function steuerabzug(ertrag: Cents, kirchensteuer: KirchensteuerSatz): Abzug {
  if (ertrag <= 0) return { kapest: 0, soli: 0, kist: 0 };
  // e / (4 + k/100) = 100 e / (400 + k)
  const kapest = Math.floor((ertrag * 100) / (400 + kirchensteuer));
  return { kapest, soli: Math.floor((kapest * 55) / 1000), kist: Math.floor((kapest * kirchensteuer) / 100) };
}

export interface AusschuettungAnteil {
  /** Bruttoausschüttung an diesen Gesellschafter */
  brutto: Cents;
  /** Davon aus dem steuerlichen Einlagekonto (§ 27 KStG): kein Kapitalertrag, kein Steuerabzug */
  ausEinlagekonto: Cents;
  kirchensteuer: KirchensteuerSatz;
}

export interface AusschuettungAnteilErgebnis extends AusschuettungAnteil, Abzug {
  /** Steuerpflichtiger Kapitalertrag */
  ertrag: Cents;
  /** Auszuzahlen */
  netto: Cents;
}

export function ausschuettungAnteil(anteil: AusschuettungAnteil): AusschuettungAnteilErgebnis {
  const ertrag = anteil.brutto - anteil.ausEinlagekonto;
  const abzug = steuerabzug(ertrag, anteil.kirchensteuer);
  return { ...anteil, ...abzug, ertrag, netto: anteil.brutto - abzug.kapest - abzug.soli - abzug.kist };
}

/**
 * Aufteilung einer Ausschüttung nach § 27 Abs. 1 Satz 3 KStG: Zuerst gilt der ausschüttbare Gewinn als verwendet, erst
 * der Rest mindert das steuerliche Einlagekonto, höchstens bis zu seinem Bestand. Ausschüttbarer Gewinn ist das
 * Eigenkapital laut Steuerbilanz zum Schluss des Vorjahres abzüglich gezeichnetem Kapital und Bestand des Einlagekontos
 * (§ 27 Abs. 1 Satz 5 KStG).
 */
export function ausEinlagekonto(leistung: Cents, ausschuettbarerGewinn: Cents, einlagekonto: Cents): Cents {
  return Math.max(0, Math.min(leistung - Math.max(0, ausschuettbarerGewinn), Math.max(0, einlagekonto)));
}

export interface AusschuettungsBuchung {
  account: string;
  debit: Cents;
  credit: Cents;
}

/**
 * Buchung zum Gewinnverwendungsbeschluss: Gewinnvortrag an Gesellschafter-Verrechnungskonto (netto) und an
 * Verbindlichkeiten aus Einbehaltungen (KapESt, Soli, KiSt).
 */
export function ausschuettungPosting(kontenrahmen: Kontenrahmen, anteile: readonly AusschuettungAnteilErgebnis[]): AusschuettungsBuchung[] {
  const summe = (f: (a: AusschuettungAnteilErgebnis) => Cents) => anteile.reduce((s, a) => s + f(a), 0);
  const brutto = summe((a) => a.brutto);
  const netto = summe((a) => a.netto);
  const steuern = brutto - netto;
  return [
    { account: VORTRAG_ACCOUNTS[kontenrahmen].gewinn, debit: brutto, credit: 0 },
    { account: ACCOUNTS[kontenrahmen].gesellschafter, debit: 0, credit: netto },
    // Verbindlichkeiten aus Einbehaltungen (KapESt und SolZ, KiSt auf KapESt) für offene Ausschüttungen
    ...(steuern > 0 ? [{ account: ACCOUNTS[kontenrahmen].kapestEinbehalt, debit: 0, credit: steuern }] : []),
  ];
}

/**
 * Frist der Kapitalertragsteuer-Anmeldung: Anmeldung und Abführung bis zum 10. des Monats nach dem Zufluss
 * (§ 44 Abs. 1 Satz 5 EStG), an einem Wochenende oder Feiertag am nächsten Werktag (§ 108 Abs. 3 AO).
 */
export function kapestFrist(zufluss: string, bundesland: Bundesland | null): string {
  // Wie die Voranmeldung ohne Dauerfristverlängerung: der 10. des Folgemonats, verschoben auf den nächsten Werktag
  return dueDate({ year: Number(zufluss.slice(0, 4)), month: Number(zufluss.slice(5, 7)) }, bundesland);
}
