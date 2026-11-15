import { type AssetKind, assetAccount, type Cents } from "@haben/core";
import { assetKeys, mapSevAsset, type SevAnlage, sevAnlageKeys, sevAnlageRow, sevKontoHinweis } from "@haben/import";
import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, type Db, type Tx } from "../../db/index.ts";
import { assetImportStichtagProblem, insertImportedAssets, planAssetCandidates } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { SevdeskError, sevdeskClient } from "./sevdesk-zugang.ts";

/*
 * Anlagenverzeichnis aus sevDesk (docs/sevdesk.md, Anlagen): GET /Asset als Vorschlag zum Stichtag, übernommen wie
 * „Anlage übernehmen“ mit Restbuchwert und denselben Prüfungen wie der CSV-Import. Die Liste kommt bei jedem Aufruf frisch
 * aus sevDesk und wird nicht gespeichert; übernommen werden nur bestätigte Anlagen, jede mit der Kennung aus sevDesk in
 * der Notiz, damit ein zweiter Aufruf sie als vorhanden erkennt. Gebucht wird nichts: Die Eröffnung entsteht mit der
 * ersten AfA-Buchung.
 */

export interface SevdeskAssetPreviewRow {
  sevId: string;
  nummer: string;
  name: string;
  acquisitionDate: string | null;
  cost: Cents;
  usefulLifeMonths: number | null;
  openingBookValue: Cents | null;
  kind: AssetKind | null;
  kategorie: string | null;
  /** Anlagekonto in Haben für die vorgeschlagene Art; null, solange die Art fehlt */
  account: string | null;
  status: "neu" | "vorhanden" | "erledigt" | "ausgeschlossen";
  grund: string | null;
  hinweise: string[];
}

export interface SevdeskAssetPreview {
  stichtag: string;
  /** Sperrt die ganze Übernahme, etwa ein Stichtag in einem gebuchten Jahr */
  problem: string | null;
  rows: SevdeskAssetPreviewRow[];
}

function checkStichtag(stichtag: string) {
  if (!/^\d{4}-01-01$/.test(stichtag)) {
    throw new SevdeskError("Anlagen aus sevDesk übernimmt Haben zum 01.01. eines Jahres: Nur dann folgt der Restbuchwert aus dem Plan des Vorjahres.");
  }
}

/** Vorschläge zum Stichtag; neu sind nur übernehmbare, die es in Haben noch nicht gibt */
async function plan(q: Db | Tx, assets: readonly SevAnlage[], stichtag: string, kinds: ReadonlyMap<string, AssetKind>) {
  const { kontenrahmen } = await loadCompany(q);
  const offered = assets.filter((a) => a.stand === "uebernehmen");
  const planned = await planAssetCandidates(
    q,
    offered.map((a, index) => {
      // Ohne Art nur die Dublettenprüfung; übernommen wird eine solche Anlage erst mit gewählter Art
      const row = sevAnlageRow(a, kinds.get(a.sevId) ?? a.kind ?? "sonstiges", stichtag);
      return { line: index, title: a.name, value: row, errors: [], keys: [...sevAnlageKeys(row.note), ...assetKeys(row)] };
    }),
    (stock) => sevAnlageKeys(stock.note),
  );
  return assets.map((a): SevdeskAssetPreviewRow & { value: (typeof planned)[number]["value"] } => {
    const kind = kinds.get(a.sevId) ?? a.kind;
    const base = {
      sevId: a.sevId,
      nummer: a.nummer,
      name: a.name,
      acquisitionDate: a.acquisitionDate,
      cost: a.cost,
      usefulLifeMonths: a.usefulLifeMonths,
      openingBookValue: a.openingBookValue,
      kind,
      kategorie: a.kategorie,
      account: kind && a.method ? assetAccount(kind, a.method, kontenrahmen) : null,
      grund: a.grund,
      hinweise: a.hinweise,
      value: null,
    };
    if (a.stand !== "uebernehmen") return { ...base, status: a.stand };
    const row = planned[offered.indexOf(a)]!;
    if (row.status === "dublette") return { ...base, status: "vorhanden", grund: row.message };
    if (row.status === "fehler") return { ...base, status: "ausgeschlossen", grund: row.message };
    const konto = kind ? sevKontoHinweis(a, kind, kontenrahmen) : null;
    return { ...base, status: "neu", hinweise: konto ? [...a.hinweise, konto] : a.hinweise, value: row.value };
  });
}

export async function previewSevdeskAssets(stichtag: string): Promise<SevdeskAssetPreview> {
  checkStichtag(stichtag);
  const raw = await fetchAll();
  const assets = raw.map((a) => mapSevAsset(a, stichtag));
  const rows = (await plan(db, assets, stichtag, new Map())).map(({ value: _, ...row }) => row);
  return { stichtag, problem: await assetImportStichtagProblem(db, stichtag), rows };
}

async function fetchAll() {
  const client = await sevdeskClient();
  const list = [];
  for await (const asset of client.assets()) list.push(asset);
  return list.sort((a, b) => Number(a.assetNumber ?? 0) - Number(b.assetNumber ?? 0));
}

export interface SevdeskAssetPick {
  sevId: string;
  /** Gewählte Art; nötig, wenn der Vorschlag keine hat */
  kind: AssetKind | null;
}

/**
 * Übernimmt die bestätigten Anlagen in einer Transaktion. Liest sevDesk neu und plant in der Transaktion neu, damit
 * nichts doppelt angelegt wird; eine bestätigte Anlage, die nicht mehr neu ist oder keine Art hat, bricht alles ab.
 */
export async function takeOverSevdeskAssets(actor: string, stichtag: string, picks: readonly SevdeskAssetPick[]): Promise<{ created: number }> {
  checkStichtag(stichtag);
  if (picks.length === 0) throw new SevdeskError("Keine Anlage ausgewählt.");
  const assets = (await fetchAll()).map((a) => mapSevAsset(a, stichtag));
  const kinds = new Map(picks.flatMap((p) => (p.kind ? [[p.sevId, p.kind] as const] : [])));
  return withActor(actor, async (tx) => {
    // Wie der CSV-Import: zwei gleichzeitige Übernahmen sähen die Anlagen der anderen nicht
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.csv-import'))`);
    const problem = await assetImportStichtagProblem(tx, stichtag);
    if (problem) throw new SevdeskError(problem);
    const rows = await plan(tx, assets, stichtag, kinds);
    const chosen = picks.map((p) => {
      const row = rows.find((r) => r.sevId === p.sevId);
      if (!row) throw new SevdeskError(`Anlage ${p.sevId} gibt es in sevDesk nicht mehr.`);
      if (row.status !== "neu" || !row.value) throw new SevdeskError(`${row.name} (Nr. ${row.nummer}): ${row.grund ?? "nicht zu übernehmen"}.`);
      if (!row.kind) throw new SevdeskError(`${row.name} (Nr. ${row.nummer}): Art wählen.`);
      return row.value;
    });
    return { created: await insertImportedAssets(tx, chosen) };
  });
}
