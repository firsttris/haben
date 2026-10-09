import { UserError } from "./errors.ts";
import {
  ACCOUNTS,
  ASSET_ACCOUNTS,
  ASSET_KIND_KEYS,
  ASSET_METHOD_KEYS,
  assetAccount,
  assetIssues,
  depreciationAccount,
  depreciationSchedule,
  CAR_DRIVE_KEYS,
  privateUseMonth,
  privateUseMonths,
  privateUsePosting,
  type CarPrivateUse,
  type EuerDepreciation,
  type EuerWithdrawals,
  type ScheduleAsset,
  type ScheduleYear,
} from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

export type Asset = typeof schema.assets.$inferSelect;

export class AssetUserError extends UserError {}

const isoDate = z.iso.date();

/**
 * Anlage aus der Vorgänger-Buchhaltung übernehmen (z. B. aus dem Anlagenverzeichnis von Lexoffice).
 * Neue Anschaffungen entstehen beim Buchen eines Belegs mit Kategorie „Anlagegut“.
 */
export const assetInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  kind: z.enum(ASSET_KIND_KEYS),
  method: z.enum(ASSET_METHOD_KEYS),
  acquisitionDate: isoDate,
  cost: z.number().int().min(1).max(100_000_000_00),
  usefulLifeMonths: z.number().int().min(1).max(600).nullable(),
  openingDate: isoDate,
  openingBookValue: z.number().int().min(0).max(100_000_000_00),
  disposalDate: isoDate.nullable(),
  /** Nur bei Fahrzeugen: private Nutzung nach der Listenpreismethode */
  privateUse: z
    .object({
      listPrice: z.number().int().min(100).max(100_000_000_00),
      drive: z.enum(CAR_DRIVE_KEYS),
      rate: z.union([z.literal(100), z.literal(50), z.literal(25)]),
      vat: z.boolean(),
    })
    .nullable()
    .default(null),
  note: z.string().max(2000),
});

export type AssetInput = z.input<typeof assetInputSchema>;

/** Was an einer Anlage nach der Anlage noch geändert werden darf */
export const assetUpdateSchema = assetInputSchema.partial().extend({ name: z.string().trim().min(1).max(200) });

function scheduleInput(asset: Asset): ScheduleAsset {
  return {
    acquisitionDate: asset.acquisitionDate,
    cost: asset.cost,
    method: asset.method,
    usefulLifeMonths: asset.usefulLifeMonths,
    opening: asset.openingDate ? { date: asset.openingDate, bookValue: asset.openingBookValue! } : null,
    disposalDate: asset.disposalDate,
  };
}

function scheduleOf(asset: Asset): ScheduleYear[] {
  try {
    return depreciationSchedule(scheduleInput(asset));
  } catch {
    return [];
  }
}

/** Privatnutzung eines Jahres: Monate, Entnahme und Umsatzsteuer */
function privateUseForYear(asset: Asset, year: number) {
  if (!asset.privateUse) return null;
  const months = privateUseMonths(asset, year);
  const month = privateUseMonth(asset.privateUse);
  return {
    months,
    month,
    withdrawal: month.withdrawal * months.length,
    vatBase: month.vatBase * months.length,
    vat: month.vat * months.length,
  };
}

/** Was im Jahr zu buchen ist: AfA laut Plan und Privatnutzung */
function yearPlan(asset: Asset, year: number) {
  const row = scheduleOf(asset).find((r) => r.year === year) ?? null;
  const privateUse = privateUseForYear(asset, year);
  const hasWork = Boolean((row && (row.depreciation !== 0 || row.disposal !== 0)) || (privateUse && privateUse.withdrawal !== 0));
  return { row, privateUse, hasWork };
}

async function bookedYears(ids: string[]): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      assetId: schema.assetDepreciations.assetId,
      year: schema.assetDepreciations.year,
    })
    .from(schema.assetDepreciations)
    .where(inArray(schema.assetDepreciations.assetId, ids));
  const map = new Map<string, number[]>();
  for (const row of rows) map.set(row.assetId, [...(map.get(row.assetId) ?? []), row.year]);
  return map;
}

/** Anlagenverzeichnis zum Jahr: Plan des Jahres und ob die AfA schon gebucht ist */
export async function listAssets(year: number) {
  const assets = await db.select().from(schema.assets).orderBy(asc(schema.assets.acquisitionDate), asc(schema.assets.name));
  const booked = await bookedYears(assets.map((a) => a.id));
  return assets.map((asset) => {
    const schedule = scheduleOf(asset);
    const row = schedule.find((r) => r.year === year) ?? null;
    const first = schedule[0]?.year ?? Number(asset.acquisitionDate.slice(0, 4));
    // Nach dem Plan: Buchwert 0 bzw. vor Beginn kein Eintrag; zur Anzeige den Stand am Jahresende
    const closing = row?.closing ?? (year < first ? null : 0);
    const years = booked.get(asset.id) ?? [];
    const plan = yearPlan(asset, year);
    return {
      ...asset,
      schedule,
      year: row,
      privateUseYear: plan.privateUse,
      pending: plan.hasWork && !years.includes(year),
      closing,
      bookedYears: years.sort((a, b) => a - b),
      editable: years.length === 0 && asset.openingEntryId === null,
    };
  });
}

export async function getAsset(id: string) {
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  if (!asset) return null;
  const booked = (await bookedYears([id])).get(id) ?? [];
  return {
    asset,
    schedule: scheduleOf(asset),
    bookedYears: booked.sort((a, b) => a - b),
  };
}

/** Übernimmt eine Anlage mit Restbuchwert zum Stichtag. */
export async function createAsset(actor: string, input: AssetInput): Promise<Asset> {
  const company = await loadCompany();
  const values = {
    ...input,
    privateUse: privateUseValue(input.kind, input.privateUse ?? null, company.kleinunternehmer),
    usefulLifeMonths: input.method === "linear" ? input.usefulLifeMonths : null,
    account: assetAccount(input.kind, input.method, company.kontenrahmen),
  };
  const issues = assetIssues(scheduleInput({ ...values, openingEntryId: null } as Asset));
  if (issues.length > 0) throw new AssetUserError(`${issues.join(", ")}.`);
  return withActor(actor, async (tx) => {
    const [created] = await tx.insert(schema.assets).values(values).returning();
    return created!;
  });
}

/**
 * Ändert eine Anlage. Ist schon etwas gebucht, gehen nur Bezeichnung, Notiz und der Abgang,
 * und der Abgang nur in ein Jahr, für das noch keine AfA gebucht ist.
 */
export async function updateAsset(actor: string, id: string, input: z.infer<typeof assetUpdateSchema>): Promise<Asset> {
  const company = await loadCompany();
  return withActor(actor, async (tx) => {
    const [asset] = await tx.select().from(schema.assets).where(eq(schema.assets.id, id)).for("update");
    if (!asset) throw new AssetUserError("Anlage nicht gefunden.");
    const years = (
      await tx.select({ year: schema.assetDepreciations.year }).from(schema.assetDepreciations).where(eq(schema.assetDepreciations.assetId, id))
    ).map((r) => r.year);
    const booked = years.length > 0 || asset.openingEntryId !== null;
    const lastBooked = years.length ? Math.max(...years) : null;

    const next: Asset = {
      ...asset,
      name: input.name,
      note: input.note ?? asset.note,
    };
    if (input.disposalDate !== undefined) {
      if (lastBooked !== null && input.disposalDate !== asset.disposalDate) {
        const changedYear = Math.min(...[input.disposalDate, asset.disposalDate].filter((d): d is string => d !== null).map((d) => Number(d.slice(0, 4))));
        if (changedYear <= lastBooked) {
          throw new AssetUserError(`Für ${lastBooked} ist die AfA schon gebucht; der Abgang kann nur in einem späteren Jahr liegen.`);
        }
      }
      next.disposalDate = input.disposalDate;
    }

    if (!booked) {
      // Grundlagen: bei Belegen stehen Art, Methode, Datum und Kosten durch die Belegbuchung fest
      const fromDocument = asset.documentId !== null;
      if (input.usefulLifeMonths !== undefined) next.usefulLifeMonths = input.usefulLifeMonths;
      if (!fromDocument) {
        for (const key of ["kind", "method", "acquisitionDate", "cost", "openingDate", "openingBookValue"] as const) {
          if (input[key] !== undefined) (next as Record<string, unknown>)[key] = input[key];
        }
        next.account = assetAccount(next.kind, next.method, company.kontenrahmen);
      } else if (input.method !== undefined && input.method !== asset.method) {
        const same = assetAccount(asset.kind, input.method, company.kontenrahmen) === asset.account;
        if (!same) throw new AssetUserError("GWG und Sammelposten werden schon bei der Belegbuchung festgelegt.");
        next.method = input.method;
      }
      if (next.method !== "linear") next.usefulLifeMonths = null;
      if (input.privateUse !== undefined) next.privateUse = privateUseValue(next.kind, input.privateUse, company.kleinunternehmer);
    } else if (input.privateUse !== undefined && !samePrivateUse(input.privateUse, asset.privateUse)) {
      throw new AssetUserError("Für die Anlage ist schon gebucht; die Privatnutzung lässt sich nicht mehr ändern.");
    }

    const issues = assetIssues(scheduleInput(next));
    if (issues.length > 0) throw new AssetUserError(`${issues.join(", ")}.`);
    const { id: _id, createdAt: _createdAt, ...values } = next;
    const [updated] = await tx
      .update(schema.assets)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.assets.id, id))
      .returning();
    return updated!;
  });
}

function samePrivateUse(a: CarPrivateUse | null, b: CarPrivateUse | null): boolean {
  if (!a || !b) return a === b;
  return a.listPrice === b.listPrice && a.drive === b.drive && a.rate === b.rate && a.vat === b.vat;
}

/** Privatnutzung nur bei Fahrzeugen; Kleinunternehmer zahlen keine Umsatzsteuer darauf */
function privateUseValue(kind: Asset["kind"], value: CarPrivateUse | null, kleinunternehmer: boolean): CarPrivateUse | null {
  if (!value) return null;
  if (kind !== "kfz") throw new AssetUserError("Privatnutzung nach der Listenpreismethode gibt es nur für Fahrzeuge.");
  return { ...value, vat: value.vat && !kleinunternehmer };
}

/** Nur übernommene Anlagen ohne Buchung lassen sich löschen */
export async function deleteAsset(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [asset] = await tx.select().from(schema.assets).where(eq(schema.assets.id, id)).for("update");
    if (!asset) throw new AssetUserError("Anlage nicht gefunden.");
    if (asset.documentId) throw new AssetUserError("Die Anlage gehört zu einem gebuchten Beleg und bleibt im Verzeichnis.");
    const [booked] = await tx
      .select({ id: schema.assetDepreciations.id })
      .from(schema.assetDepreciations)
      .where(eq(schema.assetDepreciations.assetId, id))
      .limit(1);
    if (booked || asset.openingEntryId) throw new AssetUserError("Für die Anlage ist schon gebucht; sie kann nicht mehr gelöscht werden.");
    await tx.delete(schema.assets).where(eq(schema.assets.id, id));
  });
}

/** Ab wann sich die AfA eines Jahres buchen lässt: im Dezember oder danach */
export function canBookYear(year: number, today: string): boolean {
  return today >= `${year}-12-01`;
}

/**
 * Bucht die Abschreibungen eines Jahres für alle Anlagen, festgeschrieben: AfA an Anlagekonto,
 * beim Abgang zusätzlich Restbuchwert an Anlagekonto. Übernommene Anlagen bekommen bei der
 * ersten Buchung ihre Eröffnungsbuchung (Anlagekonto an Saldenvortrag). Frühere Jahre müssen
 * zuerst gebucht sein.
 */
export async function bookDepreciation(actor: string, year: number, today: string): Promise<{ booked: number }> {
  if (!canBookYear(year, today)) throw new AssetUserError(`Die AfA für ${year} lässt sich ab dem 1. Dezember ${year} buchen.`);
  const company = await loadCompany();
  const kr = company.kontenrahmen;
  return withActor(actor, async (tx) => {
    const assets = await tx.select().from(schema.assets).orderBy(asc(schema.assets.acquisitionDate)).for("update");
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

    const missing: string[] = [];
    const todo: { asset: Asset; plan: ReturnType<typeof yearPlan> }[] = [];
    for (const asset of assets) {
      const start = Number((asset.openingDate ?? asset.acquisitionDate).slice(0, 4));
      const earlier: number[] = [];
      for (let y = start; y < year; y++) if (yearPlan(asset, y).hasWork && !done.has(`${asset.id}|${y}`)) earlier.push(y);
      if (earlier.length > 0) missing.push(`${asset.name} (${earlier.join(", ")})`);
      const plan = yearPlan(asset, year);
      if (plan.hasWork && !done.has(`${asset.id}|${year}`)) todo.push({ asset, plan });
    }
    if (missing.length > 0) throw new AssetUserError(`Zuerst die AfA früherer Jahre buchen: ${missing.join("; ")}.`);
    if (todo.length === 0) throw new AssetUserError(`Für ${year} ist keine AfA (mehr) zu buchen.`);

    const now = new Date();
    for (const { asset, plan } of todo) {
      const row: ScheduleYear = plan.row ?? {
        year,
        opening: 0,
        addition: 0,
        depreciation: 0,
        disposal: 0,
        closing: 0,
      };
      if (asset.openingDate && !asset.openingEntryId) {
        const [opening] = await tx
          .insert(schema.journalEntries)
          .values({
            date: asset.openingDate,
            description: `Eröffnung Anlage · ${asset.name}`,
            sourceType: "asset",
            sourceId: asset.id,
            kontenrahmen: kr,
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          {
            entryId: opening!.id,
            account: asset.account,
            debit: asset.openingBookValue!,
            credit: 0,
            taxCode: null,
          },
          {
            entryId: opening!.id,
            account: ACCOUNTS[kr].saldenvortrag,
            debit: 0,
            credit: asset.openingBookValue!,
            taxCode: null,
          },
        ]);
        await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, opening!.id));
        await tx.update(schema.assets).set({ openingEntryId: opening!.id }).where(eq(schema.assets.id, asset.id));
      }
      const disposalInYear = asset.disposalDate && Number(asset.disposalDate.slice(0, 4)) === year;
      let entryId: string | null = null;
      if (row.depreciation !== 0 || row.disposal !== 0) {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            date: disposalInYear ? asset.disposalDate! : `${year}-12-31`,
            description: `AfA ${year} · ${asset.name}${row.disposal ? " (Abgang)" : ""}`,
            sourceType: "asset",
            sourceId: asset.id,
            kontenrahmen: kr,
          })
          .returning();
        const lines: {
          entryId: string;
          account: string;
          debit: number;
          credit: number;
          taxCode: string | null;
        }[] = [];
        if (row.depreciation !== 0) {
          lines.push(
            {
              entryId: entry!.id,
              account: depreciationAccount(asset.kind, asset.method, kr),
              debit: row.depreciation,
              credit: 0,
              taxCode: null,
            },
            {
              entryId: entry!.id,
              account: asset.account,
              debit: 0,
              credit: row.depreciation,
              taxCode: null,
            },
          );
        }
        if (row.disposal !== 0) {
          lines.push(
            {
              entryId: entry!.id,
              account: ASSET_ACCOUNTS[kr].restbuchwert,
              debit: row.disposal,
              credit: 0,
              taxCode: null,
            },
            {
              entryId: entry!.id,
              account: asset.account,
              debit: 0,
              credit: row.disposal,
              taxCode: null,
            },
          );
        }
        await tx.insert(schema.journalLines).values(lines);
        await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, entry!.id));
        entryId = entry!.id;
      }

      // Privatnutzung: je Monat eine Entnahme zum Monatsende
      if (plan.privateUse) {
        for (const month of plan.privateUse.months) {
          const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
          const [use] = await tx
            .insert(schema.journalEntries)
            .values({
              date: end,
              description: `Privatnutzung ${String(month).padStart(2, "0")}/${year} · ${asset.name}`,
              sourceType: "asset",
              sourceId: asset.id,
              kontenrahmen: kr,
            })
            .returning();
          await tx.insert(schema.journalLines).values(
            privateUsePosting(plan.privateUse.month, kr).map((line) => ({
              entryId: use!.id,
              ...line,
            })),
          );
          await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, use!.id));
          entryId ??= use!.id;
        }
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
    return { booked: todo.length };
  });
}

/** Abschreibungen eines Jahres für die EÜR, aus dem Plan (gebucht oder nicht) */
export async function depreciationForEuer(year: number): Promise<EuerDepreciation> {
  const assets = await db.select().from(schema.assets);
  const result: EuerDepreciation = {
    afa: 0,
    gwg: 0,
    sammelposten: 0,
    restbuchwert: 0,
  };
  for (const asset of assets) {
    const row = scheduleOf(asset).find((r) => r.year === year);
    if (!row) continue;
    if (asset.method === "gwg") result.gwg += row.depreciation;
    else if (asset.method === "sammelposten") result.sammelposten += row.depreciation;
    else result.afa += row.depreciation;
    result.restbuchwert += row.disposal;
  }
  return result;
}

/** Jahre mit noch nicht gebuchter AfA, die sich schon buchen lassen (Vorjahr, im Dezember auch das laufende) */
export async function pendingDepreciation(today: string): Promise<{ year: number; count: number }[]> {
  const current = Number(today.slice(0, 4));
  const result: { year: number; count: number }[] = [];
  for (const year of [current - 1, current]) {
    if (!canBookYear(year, today)) continue;
    const count = (await listAssets(year)).filter((a) => a.pending).length;
    if (count > 0) result.push({ year, count });
  }
  return result;
}

/** Private Kfz-Nutzung eines Jahres für die EÜR */
export async function withdrawalsForEuer(year: number): Promise<EuerWithdrawals> {
  const assets = await db.select().from(schema.assets);
  const result: EuerWithdrawals = { privateKfz: 0, ustEntnahmen: 0 };
  for (const asset of assets) {
    const use = privateUseForYear(asset, year);
    if (!use) continue;
    result.privateKfz += use.withdrawal;
    result.ustEntnahmen += use.vat;
  }
  return result;
}

/** Private Kfz-Nutzung eines Monats für die Voranmeldung (Kz 81), je Fahrzeug */
export async function privateUseForMonth(year: number, month: number) {
  const assets = await db.select().from(schema.assets);
  return assets.flatMap((asset) => {
    const use = privateUseForYear(asset, year);
    if (!use || !use.months.includes(month) || use.month.vatBase === 0) return [];
    return [
      {
        assetId: asset.id,
        name: asset.name,
        base: use.month.vatBase,
        tax: use.month.vat,
      },
    ];
  });
}
