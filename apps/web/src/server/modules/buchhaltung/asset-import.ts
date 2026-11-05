import { assetCandidates, assetKeys, type ColumnMapping, type CsvTable, planRows, type PlannedRow } from "@haben/import";
import { gte, max } from "drizzle-orm";
import type { z } from "zod";
import { type Db, schema, type Tx } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { elektroIssues } from "./asset-methoden.ts";
import { type AssetInput, assetInputSchema, insertAsset } from "./assets.ts";

/*
 * CSV-Import von Anlagen (docs/csv-import.md): Übernahme mit Restbuchwert zum Stichtag wie „Anlage übernehmen“. Der
 * Import bucht nichts; die Eröffnungsbuchung entsteht erst mit der ersten AfA-Buchung (bookDepreciation), bis dahin
 * lässt sich jede übernommene Anlage ändern oder löschen.
 */

/**
 * Ein Stichtag in einem Jahr, für das schon AfA gebucht oder das abgeschlossen ist, änderte nachträglich die AfA eines
 * Jahres, dessen EÜR, Bilanz oder Voranmeldungen womöglich schon abgegeben sind. Das lehnt der Import ab; einzelne
 * Nachträge gehen weiter über „Anlage übernehmen“.
 */
export async function assetImportStichtagProblem(q: Db | Tx, stichtag: string): Promise<string | null> {
  const year = Number(stichtag.slice(0, 4));
  const [booked] = await q.select({ year: max(schema.assetDepreciations.year) }).from(schema.assetDepreciations);
  if (booked?.year && booked.year >= year) {
    return `Für ${booked.year} ist die AfA schon gebucht; der Übernahmestichtag muss danach liegen, frühestens am 01.01.${booked.year + 1}.`;
  }
  const [closed] = await q
    .select({ year: max(schema.yearClosings.year) })
    .from(schema.yearClosings)
    .where(gte(schema.yearClosings.year, year));
  if (closed?.year) return `Das Jahr ${closed.year} ist abgeschlossen; der Übernahmestichtag muss danach liegen.`;
  return null;
}

export async function planAssetImport(
  q: Db | Tx,
  table: CsvTable,
  mapping: ColumnMapping,
  stichtag: string,
): Promise<PlannedRow<z.output<typeof assetInputSchema>>[]> {
  const { rechtsform } = await loadCompany(q);
  const candidates = assetCandidates(table, mapping, stichtag).map((row) => {
    if (!row.value) return { ...row, value: null };
    // Wie insertAsset: in GmbH und UG keine Staffel nach § 7 Abs. 2a EStG, schon in der Vorschau
    const issues = elektroIssues({ method: row.value.method, privateUse: null }, rechtsform);
    if (issues.length > 0) return { ...row, value: null, errors: issues };
    const result = assetInputSchema.safeParse({ ...row.value, disposalDate: null, privateUse: null });
    return result.success ? { ...row, value: result.data } : { ...row, value: null, errors: result.error.issues.map((i) => i.message) };
  });
  const stock = await q.select({ name: schema.assets.name, acquisitionDate: schema.assets.acquisitionDate, cost: schema.assets.cost }).from(schema.assets);
  return planRows(candidates, stock.flatMap(assetKeys));
}

export async function insertImportedAssets(tx: Tx, assets: readonly AssetInput[]): Promise<number> {
  for (const asset of assets) await insertAsset(tx, asset);
  return assets.length;
}
