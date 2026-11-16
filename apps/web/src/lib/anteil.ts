import { parsePercent } from "@haben/core";

/* Anteil eines Anteilseigners in der Jahreserklärung der GmbH, in Basispunkten (10000 = 100 %) */

/** Anteil als Text: 10000 → "100", 3333 → "33,33" */
export const anteilText = (anteil: number) => (anteil / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** Anteil in Prozent über parsePercent wie jedes Prozentfeld (#1222): über 0 bis 100 %; null, wenn ungültig */
export function parseAnteil(text: string): number | null {
  const anteil = parsePercent(text);
  return anteil !== null && anteil > 0 && anteil <= 10_000 ? anteil : null;
}
