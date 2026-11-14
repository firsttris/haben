import { UNITS } from "@haben/core";

/**
 * Auswahl der Einheit in Positionen und Artikeln: feste Einheiten, dann die eigenen (#748). Eine archivierte oder
 * unbekannte Einheit, die schon in der Zeile steht, bleibt wählbar, damit das Formular sie nicht stillschweigend ersetzt.
 */
export function unitOptions(own: readonly string[], current?: string): string[] {
  const options = [...Object.keys(UNITS), ...own];
  return current && !options.includes(current) ? [...options, current] : options;
}
