import { turnoverForYear } from "@haben/core";
import { db, type Db, type Tx } from "../../db/index.ts";
import { nativeTurnoverItems } from "./gesamtumsatz-zahlungen.ts";
import type { GesamtumsatzItem, GesamtumsatzResult } from "./gesamtumsatz-quellen.ts";
import { legacyTurnoverItems } from "./gesamtumsatz-altbestand.ts";
import { journalTurnoverItems } from "./gesamtumsatz-journal.ts";
import { privateUseForMonth } from "../buchhaltung/index.ts";

export type { GesamtumsatzItem, GesamtumsatzResult } from "./gesamtumsatz-quellen.ts";

async function privateUseItems(year: number, q: Db | Tx): Promise<GesamtumsatzItem[]> {
  const months = await Promise.all(Array.from({ length: 12 }, (_, month) => privateUseForMonth(year, month + 1, q)));
  return months.flatMap((assets, month) =>
    assets.map((asset) => ({
      source: "privateUse" as const,
      sourceId: `${asset.assetId}:${month + 1}`,
      assetId: asset.assetId,
      label: asset.name,
      occurredOn: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
      gross: null,
      net: asset.base,
      basisSource: "derived" as const,
      classification: { kind: "domestic" as const },
    })),
  );
}

export async function gesamtumsatzForYear(year: number, q: Db | Tx = db): Promise<GesamtumsatzResult> {
  turnoverForYear(year, []);
  const groups = await Promise.all([nativeTurnoverItems(year, q), legacyTurnoverItems(year, q), journalTurnoverItems(year, q), privateUseItems(year, q)]);
  const items = groups.flat();
  const result = turnoverForYear(year, items);
  return {
    ...result,
    items: result.items.map((item, i) => ({
      ...items[i]!,
      ...item,
      reason: item.decision === "unknown" && items[i]!.uncertainty ? items[i]!.uncertainty! : item.reason,
    })),
  };
}
