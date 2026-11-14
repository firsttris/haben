import type { TurnoverItem, TurnoverOutcome, TurnoverResult } from "@haben/core";

/** Belegbare Navigation und Bruttobetrag bleiben getrennt von der bekannten Nettosumme. */
export interface GesamtumsatzItem extends TurnoverItem {
  label: string;
  gross: number | null;
  invoiceId?: string;
  transactionId?: string;
  assetId?: string;
  uncertainty?: string;
}

export type GesamtumsatzResult = Omit<TurnoverResult, "items"> & { items: (GesamtumsatzItem & TurnoverOutcome)[] };

export function unknownTurnover(
  source: TurnoverItem["source"],
  sourceId: string,
  label: string,
  occurredOn: string | null,
  gross: number | null,
  uncertainty: string,
): GesamtumsatzItem {
  return { source, sourceId, label, occurredOn, gross, net: null, basisSource: "unknown", classification: null, uncertainty };
}

export const turnoverRange = (year: number) => ({ start: `${year}-01-01`, end: `${year + 1}-01-01` });
