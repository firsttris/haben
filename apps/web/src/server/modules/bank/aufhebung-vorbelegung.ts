import { monthsOfPeriod } from "@haben/core";

/**
 * Vorbelegter Tag der Aufhebung (#782).
 *
 * Solange der Zeitraum der Zahlung nicht gemeldet ist, gehört die Korrektur dorthin: dann ist der Buchungstag
 * vorbelegt und nichts verschiebt sich. Ist der Zeitraum schon gemeldet, bleibt die abgegebene Voranmeldung
 * unberührt und die Aufhebung wirkt heute. Änderbar bleibt der Tag in beiden Fällen.
 */
export function vorbelegterAufhebungstag(buchungstag: string, gemeldeteMonate: readonly string[], heute: string): string {
  // Liegt die Zahlung selbst in der Zukunft (vorgehaltener Auszug), ist heute der früheste Tag
  const fruehester = buchungstag <= heute ? buchungstag : heute;
  return gemeldeteMonate.includes(buchungstag.slice(0, 7)) ? heute : fruehester;
}

/** Monatsschlüssel YYYY-MM aus Jahr und Monat einer Voranmeldung */
export function monatsschluessel(jahr: number, monat: number): string {
  return `${jahr}-${String(monat).padStart(2, "0")}`;
}

/**
 * Gesendete Zeiträume als Zahlungsmonate.
 *
 * `vat_returns` speichert den Zeitraum, nicht den Monat: Q1 steht als `month = 41`. Für die Vorbelegung zählt aber
 * der Zahlungsmonat, deshalb wird der Zeitraum über `monthsOfPeriod` in seine Monate aufgelöst. Ohne das kam
 * `2026-41` heraus, und eine abgegebene Quartalsmeldung galt nie als gemeldet.
 */
export function gesendeteMonate(rows: readonly { jahr: number; monat: number }[]): string[] {
  const monate = new Set<string>();
  for (const row of rows) {
    for (const { month } of monthsOfPeriod({ year: row.jahr, month: row.monat })) {
      monate.add(monatsschluessel(row.jahr, month));
    }
  }
  return [...monate].sort();
}
