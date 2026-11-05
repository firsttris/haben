import type { LohnStammdaten } from "../lohnabrechnung/index.ts";
import type { Cents } from "../money.ts";
import type { SvBeitraege } from "../sozialversicherung/index.ts";

/** Was die Ausfüllliste von einem Mitarbeiter braucht; der Stand, den eine Abrechnung festhält, passt dazu */
export interface SvPerson {
  personalnummer: number;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  steuerId: string;
  svNummer: string;
  krankenkasse: string;
  krankenkasseBetriebsnummer: string;
  personengruppe: string;
  beitragsgruppen: string;
  taetigkeitsschluessel: string;
  lohn: LohnStammdaten;
}

/** Eine festgeschriebene, nicht stornierte Abrechnung mit dem Stand der Stammdaten, mit dem sie gerechnet ist */
export interface SvAbrechnung {
  jahr: number;
  monat: number;
  person: SvPerson;
  /** Sozialversicherungsbrutto des Monats (tatsächliches Entgelt) */
  svBrutto: Cents;
  sv: SvBeitraege;
}

export interface Einzugsstelle {
  art: "krankenkasse" | "minijob-zentrale";
  name: string;
  /** Betriebsnummer, 8 Ziffern; leer, wenn sie in den Stammdaten fehlt */
  betriebsnummer: string;
}

/** Ein Feld zum Abtippen, wie es im Formular des SV-Meldeportals steht */
export interface Feld {
  name: string;
  /** Der Wert, wie er einzutragen ist; leer, wenn Haben ihn nicht kennt */
  wert: string;
  /** Schlüssel der Beitragsgruppe im Beitragsnachweis, z. B. 1000 */
  schluessel?: string;
  /** Erklärung oder warum der Wert fehlt */
  hinweis?: string;
  /** Pflichtangabe, die in den Stammdaten fehlt */
  fehlt?: boolean;
}

/** Ein Abschnitt des Formulars */
export interface Abschnitt {
  titel: string;
  felder: Feld[];
}

const zwei = (n: number) => String(n).padStart(2, "0");

/** Datum zum Abtippen, TT.MM.JJJJ */
export const datumText = (iso: string): string => iso.split("-").reverse().join(".");

/** Betrag zum Abtippen ohne Tausenderpunkt und Währung, z. B. „1234,56“ */
export function betragText(cents: Cents): string {
  const vorzeichen = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${vorzeichen}${Math.floor(abs / 100)},${zwei(abs % 100)}`;
}

/** „2026-11“ */
export const monatsschluessel = (jahr: number, monat: number): string => `${jahr}-${zwei(monat)}`;
