import { parsePercent, parseWholePercent } from "@haben/core";

/* Anteile in Prozent, gelesen über den Leser der Prozentfelder aus @haben/core (#1222) */

export const PRIVATANTEIL_FEHLER = "Trag eine ganze Zahl von 0 bis 100 ein.";

/** Privatanteil am Beleg und als Vorgabe in den Firmendaten: ganze Prozent von 0 bis 100, leer ist 0; null, wenn ungültig */
export function parsePrivatanteil(text: string): number | null {
  if (text.trim() === "") return 0;
  const anteil = parseWholePercent(text);
  return anteil !== null && anteil <= 100 ? anteil : null;
}

/** Anteil eines Anteilseigners in der Jahreserklärung der GmbH als Text, in Basispunkten: 10000 → "100", 3333 → "33,33" */
export const anteilText = (anteil: number) => (anteil / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** Anteil eines Anteilseigners in Basispunkten: über 0 bis 100 %; null, wenn ungültig */
export function parseAnteil(text: string): number | null {
  const anteil = parsePercent(text);
  return anteil !== null && anteil > 0 && anteil <= 10_000 ? anteil : null;
}
