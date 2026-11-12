import type { AdvanceVatEvent } from "./anzahlung-steuer.ts";
import type { Kontenrahmen, PostingLine, TaxShare } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

export interface AdvanceBalanceEvent extends AdvanceVatEvent {
  /** Bei writtenOff erforderlich: Das normale Ausbuchungskonto wird bis zur Leistung neutralisiert. */
  kind?: "skonto" | "forderungsausfall";
}

export interface AdvanceBalanceChange {
  date: string;
  lines: PostingLine[];
}

/** Datierte Differenz zweier eigener Abgrenzungspläne, ohne Rücklesen des Journals. */
export function advanceBalanceDifference(_before: readonly AdvanceBalanceChange[], _after: readonly AdvanceBalanceChange[]): AdvanceBalanceChange[] {
  return [];
}

/** Zusätzliche Abgrenzungsbuchungen zur normalen Zahlung und Ausbuchung, ohne Umsatzsteuermeldung. */
export function advanceBalancePlan(
  _total: readonly TaxShare[],
  _events: readonly AdvanceBalanceEvent[],
  _kontenrahmen: Kontenrahmen,
  _treatment: TaxTreatment = "regulaer",
): AdvanceBalanceChange[] {
  return [];
}
