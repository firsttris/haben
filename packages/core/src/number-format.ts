/*
 * Nummernformate für Rechnungen und Angebote, z. B. "RE-{JJJJ}-{NNN}" → "RE-2026-034".
 *
 * Platzhalter: {JJJJ} vierstelliges Jahr, {JJ} zweistelliges Jahr, {MM} zweistelliger Monat, alle aus dem Belegdatum,
 * {N} bis {NNNNNN} die laufende Nummer mit so vielen Stellen mindestens. Je Nummernkreis beginnt der Zähler jedes Jahr
 * bei 1 oder läuft durch (counterCircle, number-counter.ts). Beginnt er jährlich neu, ist erst mit dem Jahr im Format
 * jede Nummer eindeutig (§ 14 Abs. 4 Nr. 4 UStG); einmalig muss sie nur sein, jährlich neu oder durchlaufend ist beides
 * zulässig (UStAE 14.5 Abs. 10). Weil Jahr, Monat und Text feste Breite haben und nur die laufende Nummer wächst,
 * ergibt ein Format nie zweimal dieselbe Nummer.
 */

export const DEFAULT_INVOICE_NUMBER_FORMAT = "{JJJJ}-{NNN}";
export const DEFAULT_QUOTE_NUMBER_FORMAT = "AN-{JJJJ}-{NNN}";
/** Vorschlag für Kundennummern; deren Zähler läuft durch, ohne Jahr */
export const DEFAULT_CUSTOMER_NUMBER_FORMAT = "K-{NNNN}";

export const MAX_NUMBER_FORMAT_LENGTH = 30;

const PLACEHOLDER = /\{([^{}]*)\}/g;
const COUNTER = /^N{1,6}$/;
const YEAR = /^(JJJJ|JJ)$/;
const MONTH = /^MM$/;
// Die Nummer steht in Dateinamen und im Verwendungszweck: kein Leerzeichen, kein Schrägstrich
const LITERAL = /^[A-Za-z0-9._-]*$/;

/**
 * Nummer aus Format, Belegdatum (JJJJ-MM-TT) und laufender Nummer; das Format ist mit numberFormatError geprüft. Jahr
 * und Monat kommen aus dem Rechnungs- bzw. Angebotsdatum, nicht aus dem heutigen Tag (#328).
 */
export function formatDocumentNumber(format: string, date: string, counter: number): string {
  const year = Number(date.slice(0, 4));
  return format.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "JJJJ") return String(year);
    if (name === "JJ") return String(year % 100).padStart(2, "0");
    if (name === "MM") return date.slice(5, 7);
    return String(counter).padStart(name.length, "0");
  });
}

/**
 * Schlüssel des Zählers: das Jahr des Belegdatums, wenn der Zähler jedes Jahr neu beginnt, sonst 0 für den einen
 * durchlaufenden Kreis. So steht er in den Zählertabellen und in number_year der festgeschriebenen Belege.
 */
export function counterCircle(running: boolean, date: string): number {
  return running ? 0 : Number(date.slice(0, 4));
}

/**
 * Warum ein Format nicht taugt, als Satz für die Oberfläche; null = in Ordnung. requireYear: false für Nummern, deren
 * Zähler nicht jährlich neu beginnt (Kundennummern, durchlaufende Nummernkreise); dort ist das Jahr erlaubt, aber nicht
 * nötig.
 */
export function numberFormatError(format: string, { requireYear = true }: { requireYear?: boolean } = {}): string | null {
  if (format.length > MAX_NUMBER_FORMAT_LENGTH) return `Das Format darf höchstens ${MAX_NUMBER_FORMAT_LENGTH} Zeichen lang sein.`;
  const names = [...format.matchAll(PLACEHOLDER)].map((m) => m[1]!);
  const unknown = names.find((name) => !COUNTER.test(name) && !YEAR.test(name) && !MONTH.test(name));
  if (unknown !== undefined) return `Den Platzhalter {${unknown}} gibt es nicht. Möglich sind {JJJJ}, {JJ}, {MM} und {N} bis {NNNNNN}.`;
  if (!LITERAL.test(format.replace(PLACEHOLDER, ""))) {
    return "Außerhalb der Platzhalter gehen nur Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt.";
  }
  const counters = names.filter((name) => COUNTER.test(name)).length;
  if (counters === 0) return "Das Format braucht die laufende Nummer, z. B. {NNN}.";
  if (counters > 1) return "Die laufende Nummer darf nur genau einmal vorkommen.";
  if (requireYear && !names.some((name) => YEAR.test(name)))
    return "Das Format braucht das Jahr ({JJJJ} oder {JJ}), weil die laufende Nummer jedes Jahr neu beginnt.";
  return null;
}
