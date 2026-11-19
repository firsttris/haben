import type { Betragszeile, BetragsSatz } from "../../../lib/betragszeile.ts";

// Betragszeile des Belegformulars

export type Rate = BetragsSatz;

export interface AmountState extends Betragszeile {
  vorsteuerAnteil: string;
}

let nextKey = 1;

/** Schlüssel für eine neue Betragszeile */
export function nextRowKey() {
  return nextKey++;
}
