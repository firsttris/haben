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
