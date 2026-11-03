/*
 * Nummernformate für Rechnungen und Angebote, z. B. "RE-{JJJJ}-{NNN}" → "RE-2026-034".
 *
 * Platzhalter: {JJJJ} vierstelliges Jahr, {JJ} zweistelliges Jahr, {N} bis {NNNNNN} die laufende Nummer mit so vielen
 * Stellen mindestens. Der Zähler beginnt jedes Jahr bei 1 (number-counter.ts); erst mit dem Jahr im Format ist jede
 * Nummer eindeutig (§ 14 Abs. 4 Nr. 4 UStG). Weil Jahr und Text feste Breite haben und nur die laufende Nummer wächst,
 * ergibt ein Format nie zweimal dieselbe Nummer.
 */

export const DEFAULT_INVOICE_NUMBER_FORMAT = "{JJJJ}-{NNN}";
export const DEFAULT_QUOTE_NUMBER_FORMAT = "AN-{JJJJ}-{NNN}";

export const MAX_NUMBER_FORMAT_LENGTH = 30;

const PLACEHOLDER = /\{([^{}]*)\}/g;
const COUNTER = /^N{1,6}$/;
const YEAR = /^(JJJJ|JJ)$/;
// Die Nummer steht in Dateinamen und im Verwendungszweck: kein Leerzeichen, kein Schrägstrich
const LITERAL = /^[A-Za-z0-9._-]*$/;

/** Nummer aus Format, Jahr und laufender Nummer; das Format ist mit numberFormatError geprüft */
export function formatDocumentNumber(format: string, year: number, counter: number): string {
  return format.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "JJJJ") return String(year);
    if (name === "JJ") return String(year % 100).padStart(2, "0");
    return String(counter).padStart(name.length, "0");
  });
}

/** Warum ein Format nicht taugt, als Satz für die Oberfläche; null = in Ordnung */
export function numberFormatError(format: string): string | null {
  if (format.length > MAX_NUMBER_FORMAT_LENGTH) return `Das Format darf höchstens ${MAX_NUMBER_FORMAT_LENGTH} Zeichen lang sein.`;
  const names = [...format.matchAll(PLACEHOLDER)].map((m) => m[1]!);
  const unknown = names.find((name) => !COUNTER.test(name) && !YEAR.test(name));
  if (unknown !== undefined) return `Den Platzhalter {${unknown}} gibt es nicht. Möglich sind {JJJJ}, {JJ} und {N} bis {NNNNNN}.`;
  if (!LITERAL.test(format.replace(PLACEHOLDER, ""))) {
    return "Außerhalb der Platzhalter gehen nur Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt.";
  }
  const counters = names.filter((name) => COUNTER.test(name)).length;
  if (counters === 0) return "Das Format braucht die laufende Nummer, z. B. {NNN}.";
  if (counters > 1) return "Die laufende Nummer darf nur genau einmal vorkommen.";
  if (!names.some((name) => YEAR.test(name))) return "Das Format braucht das Jahr ({JJJJ} oder {JJ}), weil die laufende Nummer jedes Jahr neu beginnt.";
  return null;
}
