import { ACCOUNTS, ASSET_ACCOUNTS, depreciationAccount, privateUsePosting, type PostingLine, type ScheduleYear } from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { type Asset, AssetUserError, canBookYear, kleinunternehmerInYear, yearPlan } from "./assets.ts";
import { stapelOpeningCovering } from "./eroeffnung.ts";
import { openBooks, post } from "./ledger.ts";

/*
 * Buchen der Abschreibungen eines Jahres (assets.ts hält Anlagen und Plan): AfA, Abgang, Eröffnung übernommener
 * Anlagen und Privatnutzung, festgeschrieben.
 */

type Books = Awaited<ReturnType<typeof openBooks>>;
type YearPlan = ReturnType<typeof yearPlan>;

/** Was im Jahr zu buchen ist; fehlen frühere Jahre, bricht es mit ihrer Liste ab */
function todoOfYear(assets: Asset[], done: Set<string>, year: number, kleinunternehmer: Awaited<ReturnType<typeof kleinunternehmerInYear>>) {
  const missing: string[] = [];
  const todo: { asset: Asset; plan: YearPlan }[] = [];
  for (const asset of assets) {
    const start = Number((asset.openingDate ?? asset.acquisitionDate).slice(0, 4));
    const earlier: number[] = [];
    for (let y = start; y < year; y++) if (yearPlan(asset, y).hasWork && !done.has(`${asset.id}|${y}`)) earlier.push(y);
    if (earlier.length > 0) missing.push(`${asset.name} (${earlier.join(", ")})`);
    const plan = yearPlan(asset, year, kleinunternehmer);
    if (plan.hasWork && !done.has(`${asset.id}|${year}`)) todo.push({ asset, plan });
  }
  if (missing.length > 0) throw new AssetUserError(`Zuerst die AfA früherer Jahre buchen: ${missing.join("; ")}.`);
  if (todo.length === 0) throw new AssetUserError(`Für ${year} ist keine AfA (mehr) zu buchen.`);
  return todo;
}

/** Eröffnungsbuchung einer übernommenen Anlage bei ihrer ersten AfA (Anlagekonto an Saldenvortrag) */
async function bookOpening(tx: Tx, books: Books, asset: Asset): Promise<void> {
  if (!asset.openingDate || asset.openingEntryId) return;
  const kr = books.kontenrahmen;
  // Steht die Anlage schon in der Eröffnung aus dem DATEV-Stapel, verweist sie darauf statt noch einmal zu buchen
  const covering = await stapelOpeningCovering(tx, asset.acquisitionDate);
  const openingEntryId =
    covering?.id ??
    (await post(tx, books, {
      date: asset.openingDate,
      description: `Eröffnung Anlage · ${asset.name}`,
      sourceType: "asset",
      sourceId: asset.id,
      lines: [
        { account: asset.account, debit: asset.openingBookValue!, credit: 0, taxCode: null },
        { account: ACCOUNTS[kr].saldenvortrag, debit: 0, credit: asset.openingBookValue!, taxCode: null },
      ],
    }));
  await tx.update(schema.assets).set({ openingEntryId }).where(eq(schema.assets.id, asset.id));
}

/** AfA und Abgang eines Jahres als eine Buchung; null, wenn beides 0 ist */
async function bookDepreciationRow(tx: Tx, books: Books, asset: Asset, row: ScheduleYear, year: number): Promise<string | null> {
  if (row.depreciation === 0 && row.disposal === 0) return null;
  const kr = books.kontenrahmen;
  const disposalInYear = asset.disposalDate && Number(asset.disposalDate.slice(0, 4)) === year;
  const lines: PostingLine[] = [];
  if (row.depreciation !== 0) {
    lines.push(
      { account: depreciationAccount(asset.kind, asset.method, kr), debit: row.depreciation, credit: 0, taxCode: null },
      { account: asset.account, debit: 0, credit: row.depreciation, taxCode: null },
    );
  }
  if (row.disposal !== 0) {
    lines.push(
      { account: ASSET_ACCOUNTS[kr].restbuchwert, debit: row.disposal, credit: 0, taxCode: null },
      { account: asset.account, debit: 0, credit: row.disposal, taxCode: null },
    );
  }
  return post(tx, books, {
    date: disposalInYear ? asset.disposalDate! : `${year}-12-31`,
    description: `AfA ${year} · ${asset.name}${row.disposal ? " (Abgang)" : ""}`,
    sourceType: "asset",
    sourceId: asset.id,
    lines,
  });
}

/** Privatnutzung: je Monat eine Entnahme zum Monatsende; die Id der ersten Buchung oder null */
async function bookPrivateUse(tx: Tx, books: Books, asset: Asset, privateUse: NonNullable<YearPlan["privateUse"]>, year: number) {
  let first: string | null = null;
  for (const [index, month] of privateUse.months.entries()) {
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const useId = await post(tx, books, {
      date: end,
      description: `Privatnutzung ${String(month).padStart(2, "0")}/${year} · ${asset.name}`,
      sourceType: "asset",
      sourceId: asset.id,
      lines: privateUsePosting(privateUse.byMonth[index]!, books.kontenrahmen),
    });
    first ??= useId;
  }
  return first;
}

/** Eine Anlage im Jahr: Eröffnung, AfA und Abgang, Privatnutzung, dann die Zeile in asset_depreciations */
async function bookAssetYear(tx: Tx, books: Books, asset: Asset, plan: YearPlan, year: number): Promise<void> {
  const row: ScheduleYear = plan.row ?? { year, opening: 0, addition: 0, depreciation: 0, disposal: 0, closing: 0 };
  await bookOpening(tx, books, asset);
  let entryId = await bookDepreciationRow(tx, books, asset, row, year);
  if (plan.privateUse) {
    const useId = await bookPrivateUse(tx, books, asset, plan.privateUse, year);
    entryId ??= useId;
  }
  await tx.insert(schema.assetDepreciations).values({
    assetId: asset.id,
    year,
    depreciation: row.depreciation,
    disposal: row.disposal,
    privateUse: plan.privateUse?.withdrawal ?? 0,
    privateUseVat: plan.privateUse?.vat ?? 0,
    entryId: entryId!,
  });
}

/**
 * Bucht die Abschreibungen eines Jahres für alle Anlagen, festgeschrieben: AfA an Anlagekonto,
 * beim Abgang zusätzlich Restbuchwert an Anlagekonto. Übernommene Anlagen bekommen bei der
 * ersten Buchung ihre Eröffnungsbuchung (Anlagekonto an Saldenvortrag). Frühere Jahre müssen
 * zuerst gebucht sein.
 */
export async function bookDepreciation(actor: string, year: number, today: string): Promise<{ booked: number }> {
  if (!canBookYear(year, today)) throw new AssetUserError(`Die AfA für ${year} lässt sich ab dem 1. Dezember ${year} buchen.`);
  return withActor(actor, async (tx) => {
    const assets = await tx.select().from(schema.assets).orderBy(asc(schema.assets.acquisitionDate)).for("update");
    const books = await openBooks(tx);
    const rows = assets.length
      ? await tx
          .select()
          .from(schema.assetDepreciations)
          .where(
            inArray(
              schema.assetDepreciations.assetId,
              assets.map((a) => a.id),
            ),
          )
      : [];
    const done = new Set(rows.map((r) => `${r.assetId}|${r.year}`));
    const kleinunternehmer = await kleinunternehmerInYear(year);
    const todo = todoOfYear(assets, done, year, kleinunternehmer);
    for (const { asset, plan } of todo) await bookAssetYear(tx, books, asset, plan, year);
    return { booked: todo.length };
  });
}
