import type { BasisPoints } from "./money.ts";

/** Voller Vorsteuerabzug in Basispunkten */
export const VOLLER_ABZUG: BasisPoints = 10_000;

/**
 * Abziehbarer Anteil der Vorsteuer eines Belegs. Kleinunternehmer ziehen nie ab: Ihre Umsätze sind steuerfrei
 * (§ 19 Abs. 1 Satz 1 UStG) und schließen den Abzug aus (§ 15 Abs. 2 Satz 1 Nr. 1, Abs. 3 Satz 2 UStG), auch gegen
 * eine Angabe am Beleg. Sonst gilt die Angabe am Beleg, ohne sie die Vorgabe der Firmendaten.
 */
export function abziehbarerAnteil(firma: { kleinunternehmer: boolean; ohneVorsteuerabzug: boolean }, amBeleg: BasisPoints | null): BasisPoints {
  if (firma.kleinunternehmer) return 0;
  return amBeleg ?? (firma.ohneVorsteuerabzug ? 0 : VOLLER_ABZUG);
}
