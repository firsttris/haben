import { frequencyAt, type VatFrequencySetting } from "@haben/core";

/**
 * Monate eines Jahres, für die eine Voranmeldung fällig war und in Haben keine gesendet wurde.
 *
 * Monate vor dem Beginn der Tätigkeit bleiben außen vor: Wer im Oktober anfängt, war im Januar nicht
 * voranmeldepflichtig, und eine fehlende Anmeldung ist dort kein Befund. Ohne Eintrag für das Jahr gilt
 * der gesetzliche Standard (monatlich) für alle zwölf Monate.
 */
export function fehlendeMonate(settings: readonly VatFrequencySetting[], year: number, covered: ReadonlySet<number>): number[] {
  const beginn = beginnDerTaetigkeit(settings, year);
  return Array.from({ length: 12 }, (_, i) => i + 1).filter(
    (m) => !covered.has(m) && frequencyAt(settings, { year, month: m }) !== "keine" && (beginn === null || m >= beginn),
  );
}

/**
 * Erster Monat des Jahres, ab dem die Tätigkeit angemeldet war. null, wenn keine Grenze gilt: entweder
 * fehlt für das Jahr jeder Eintrag (dann gilt der gesetzliche Standard), oder es gibt einen Eintrag aus
 * einem früheren Jahr.
 *
 * Der zweite Fall ist der Wechsel des Voranmeldungszeitraums innerhalb eines Jahres. Wer seit 2024
 * monatlich abgibt und ab Juli 2025 vierteljährlich, hat im laufenden Jahr einen Eintrag ab Juli; die
 * Tätigkeit begann aber nicht im Juli, sondern vor 2025. Ein Eintrag aus einem früheren Jahr ist deshalb
 * kein Beginn, und Januar bis Juni bleiben prüfbar.
 */
function beginnDerTaetigkeit(settings: readonly VatFrequencySetting[], year: number): number | null {
  const imJahr = settings.filter((s) => s.year === year);
  if (imJahr.length === 0) return null;
  if (settings.some((s) => s.year < year)) return null;
  return Math.min(...imJahr.map((s) => s.fromMonth));
}
