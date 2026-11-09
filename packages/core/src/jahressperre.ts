import { currentMonth } from "./period.ts";

/**
 * Jahressperre für Rechenwerte, die jedes Jahr neu erscheinen (PAP der Lohnsteuer, Rechengrößen und Beitragssätze
 * der Sozialversicherung). Haben rechnet ein Jahr ohne hinterlegte Werte nicht, auch nicht mit denen des Vorjahres.
 */

/**
 * Jahre, deren Werte am Tag `heute` fehlen: das laufende Jahr und ab Dezember auch das folgende. Die Werte für das
 * nächste Jahr erscheinen meist im Oktober oder November; ab Dezember soll die CI deshalb fehlschlagen, bis sie
 * hinterlegt sind.
 */
export function fehlendeJahre(heute: Date, hinterlegt: readonly number[]): number[] {
  const { year: jahr, month } = currentMonth(heute);
  const noetig = month === 12 ? [jahr, jahr + 1] : [jahr];
  return noetig.filter((j) => !hinterlegt.includes(j));
}
