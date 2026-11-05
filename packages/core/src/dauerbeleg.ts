/**
 * Dauerbelege: wiederkehrende Ausgaben (Miete, Versicherung, Leasing, Abos) einmal als Vorlage erfasst; Haben legt daraus
 * im Intervall Eingangsbelege an. Termine wie bei wiederkehrenden Rechnungen (recurring.ts): Ankertag, der 31. wird in
 * kürzeren Monaten zum Monatsende und springt danach zurück, verpasste Termine werden nachgeholt.
 */
import type { Cents } from "./money.ts";
import { addMonthsAnchored, dueDates, type RecurringInterval } from "./recurring.ts";

/** aktiv = legt Belege an, pausiert = vorübergehend nicht, beendet = endgültig (Enddatum erreicht oder von Hand) */
export const DAUERBELEG_STATUS = {
  aktiv: "aktiv",
  pausiert: "pausiert",
  beendet: "beendet",
} as const;

export type DauerbelegStatus = keyof typeof DAUERBELEG_STATUS;

export const DAUERBELEG_STATUS_KEYS = Object.keys(DAUERBELEG_STATUS) as [DauerbelegStatus, ...DauerbelegStatus[]];

export interface DauerbelegTermine {
  nextDate: string;
  intervalMonths: RecurringInterval;
  anchorDay: number;
  endDate: string | null;
}

export interface DauerbelegBetrag {
  taxRate: number;
  net: Cents;
  tax: Cents;
}

/**
 * Periode eines Termins: der Monatserste. Je Vorlage und Periode entsteht höchstens ein Beleg (eindeutiger Index), auch
 * wenn der nächste Termin von Hand auf einen anderen Tag im selben Monat verschoben wird.
 */
export function dauerbelegPeriode(termin: string): string {
  return `${termin.slice(0, 7)}-01`;
}

/** Alle fälligen Termine bis einschließlich heute, höchstens bis zum Enddatum; verpasste werden nachgeholt */
export function faelligeTermine(vorlage: DauerbelegTermine, heute: string): string[] {
  return dueDates(vorlage.nextDate, vorlage.intervalMonths, vorlage.anchorDay, heute, vorlage.endDate);
}

/** Termin nach dem angegebenen, am Ankertag */
export function folgeTermin(termin: string, vorlage: Pick<DauerbelegTermine, "intervalMonths" | "anchorDay">): string {
  return addMonthsAnchored(termin, vorlage.intervalMonths, vorlage.anchorDay);
}

/** Die nächsten Termine für die Vorschau, höchstens bis zum Enddatum */
export function vorschauTermine(vorlage: DauerbelegTermine, anzahl: number): string[] {
  const termine: string[] = [];
  let termin = vorlage.nextDate;
  while (termine.length < anzahl && (!vorlage.endDate || termin <= vorlage.endDate)) {
    termine.push(termin);
    termin = folgeTermin(termin, vorlage);
  }
  return termine;
}

/**
 * Erster Termin am oder nach dem Stichtag. Beim Fortsetzen nach einer Pause: Termine, die in die Pause fielen, legt
 * Haben nicht an (etwa mietfreie Monate); wer sie doch will, setzt den nächsten Termin zurück.
 */
export function terminAbStichtag(vorlage: Pick<DauerbelegTermine, "nextDate" | "intervalMonths" | "anchorDay">, stichtag: string): string {
  let termin = vorlage.nextDate;
  for (let i = 0; termin < stichtag && i < 1200; i++) termin = folgeTermin(termin, vorlage);
  return termin;
}

/** Fällig am: Termin plus Zahlungsziel in Tagen (0 = am Termin) */
export function dauerbelegFaellig(termin: string, tage: number): string {
  const date = new Date(`${termin}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + tage);
  return date.toISOString().slice(0, 10);
}

/** Was gegen die Vorlage spricht; leere Liste = in Ordnung */
export function dauerbelegProbleme(vorlage: {
  nextDate: string;
  endDate: string | null;
  category: string;
  amounts: DauerbelegBetrag[];
  /** Das hinterlegte Dokument weist die Umsatzsteuer gesondert aus (Dauerrechnung, Vertrag mit Steuerbetrag) */
  taxShown: boolean;
}): string[] {
  const probleme: string[] = [];
  if (vorlage.endDate && vorlage.endDate < vorlage.nextDate) probleme.push("Das Ende liegt vor dem nächsten Termin.");
  if (vorlage.category === "anlage") probleme.push("Anlagegüter werden nicht als Dauerbeleg erfasst, sondern einzeln mit Abschreibung.");
  if (vorlage.amounts.length === 0 || vorlage.amounts.every((a) => a.net === 0 && a.tax === 0)) probleme.push("Beträge fehlen.");
  if (vorlage.amounts.some((a) => a.net < 0 || a.tax < 0)) probleme.push("Dauerbelege sind Ausgaben; Gutschriften erfasst du als einzelnen Beleg.");
  if (new Set(vorlage.amounts.map((a) => a.taxRate)).size !== vorlage.amounts.length) probleme.push("Jeder Steuersatz nur einmal.");
  // § 15 Abs. 1 Nr. 1 UStG: Vorsteuer nur aus einer Rechnung mit gesondert ausgewiesener Steuer (§ 14 Abs. 4 Nr. 8 UStG);
  // ein Vertrag gilt als Rechnung, wenn er die Angaben enthält (UStAE 14.1 Abs. 2)
  if (!vorlage.taxShown && vorlage.amounts.some((a) => a.tax !== 0)) probleme.push(VORSTEUER_HINWEIS);
  return probleme;
}

/** Hinweis, wenn das Dokument keine Umsatzsteuer ausweist */
export const VORSTEUER_HINWEIS =
  "Vorsteuer nur mit einem Dokument, das die Umsatzsteuer gesondert ausweist (Dauerrechnung oder Vertrag mit Steuerbetrag). Ohne Steuerausweis den Betrag mit 0 % erfassen.";

/** Summen der Beträge: Netto, Steuer, Brutto */
export function dauerbelegSummen(amounts: DauerbelegBetrag[]): { net: Cents; tax: Cents; gross: Cents } {
  const net = amounts.reduce((s, a) => s + a.net, 0);
  const tax = amounts.reduce((s, a) => s + a.tax, 0);
  return { net, tax, gross: net + tax };
}
