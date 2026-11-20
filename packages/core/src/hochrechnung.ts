import type { Cents } from "./money.ts";

const tagImJahr = (datum: string) => Math.round((Date.parse(`${datum}T00:00:00Z`) - Date.parse(`${datum.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Betrag vom 1. Januar bis zum Stichtag (einschließlich) taggenau auf das ganze Kalenderjahr hochgerechnet, auf volle Euro
 * gerundet. Die Prognose der Einkommensteuer (finanzamt/prepaymentBasis) rechnet so den Gewinn hoch; die
 * Liquiditätsvorschau nimmt dieselbe Rechnung, damit beide zur selben Zahl kommen (#1381).
 */
export function hochrechnungAufsJahr(betrag: Cents, stichtag: string): Cents {
  const tage = tagImJahr(stichtag);
  const tageImJahr = tagImJahr(`${stichtag.slice(0, 4)}-12-31`);
  return Math.round((betrag * tageImJahr) / tage / 100) * 100;
}
