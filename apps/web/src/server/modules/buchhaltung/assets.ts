import { UserError } from "../../errors.ts";
import {
  currentYear,
  ASSET_KIND_KEYS,
  ASSET_METHOD_KEYS,
  assetAccount,
  assetIssues,
  depreciationSchedule,
  CAR_DRIVE_KEYS,
  privateUseMonth,
  privateUseMonths,
  type CarPrivateUse,
  type EuerDepreciation,
  type EuerWithdrawals,
  type ScheduleAsset,
  type ScheduleYear,
  isKapitalgesellschaft,
  inBasisPoints,
  inCents,
} from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { kleinunternehmerHistory, lastDayOfMonth, loadCompany, type Company } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
// Für Aufrufer, die das Buchen hier suchen (Tests); gebucht wird in assets-buchen.ts
export { bookDepreciation } from "./assets-buchen.ts";
import { elektroIssues, methodValues, switchToLinearProblem } from "./asset-methoden.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

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
  cost: inCents(z.number().int().min(1).max(100_000_000_00)),
  usefulLifeMonths: z.number().int().min(1).max(600).nullable(),
  /** Nur bei degressiv: Satz in Basispunkten; ohne Angabe der Höchstsatz */
  degressiveRate: inBasisPoints(z.number().int().min(1).max(3000)).nullable().default(null),
  /** Nur bei degressiv: ab diesem Jahr linear (§ 7 Abs. 3 EStG) */
  linearFromYear: z.number().int().min(2000).max(2200).nullable().default(null),
  /** Erinnerungswert von 1 € bis zum Abgang */
  memoValue: z.boolean().default(false),
  openingDate: isoDate,
  openingBookValue: inCents(z.number().int().min(0).max(100_000_000_00)),
  disposalDate: isoDate.nullable(),
  /** Nur bei Fahrzeugen: private Nutzung nach der Listenpreismethode */
  privateUse: z
    .object({
      listPrice: inCents(z.number().int().min(100).max(100_000_000_00)),
      drive: z.enum(CAR_DRIVE_KEYS),
      rate: inBasisPoints(z.union([z.literal(100), z.literal(50), z.literal(25)])),
      vat: z.boolean(),
    })
    .nullable()
    .default(null),
  note: z.string().max(2000),
});

export type AssetInput = z.input<typeof assetInputSchema>;

/** Was an einer Anlage nach der Anlage noch geändert werden darf */
export const assetUpdateSchema = assetInputSchema.partial().extend({
  name: z.string().trim().min(1).max(200),
  // Ohne Vorgabe, damit eine Änderung ohne diese Felder sie nicht zurücksetzt
  degressiveRate: inBasisPoints(z.number().int().min(1).max(3000)).nullable().optional(),
  linearFromYear: z.number().int().min(2000).max(2200).nullable().optional(),
  memoValue: z.boolean().optional(),
});

function scheduleInput(asset: Asset): ScheduleAsset {
  return {
    acquisitionDate: asset.acquisitionDate,
    cost: asset.cost,
    method: asset.method,
    kind: asset.kind,
    usefulLifeMonths: asset.usefulLifeMonths,
    degressiveRate: asset.degressiveRate,
    linearFromYear: asset.linearFromYear,
    memoValue: asset.memoValue,
    opening: asset.openingDate ? { date: asset.openingDate, bookValue: asset.openingBookValue! } : null,
    disposalDate: asset.disposalDate,
  };
}

/** Plan bis mindestens untilYear: Mit Erinnerungswert hat jedes Jahr bis dahin seine Zeile mit 1 € Buchwert */
function scheduleOf(asset: Asset, untilYear: number): ScheduleYear[] {
  try {
    return depreciationSchedule(scheduleInput(asset), untilYear);
  } catch {
    return [];
  }
}

/** Kleinunternehmer je Monat (Stand am Monatsende, wie die Voranmeldung) */
type KleinunternehmerInMonth = (month: number) => boolean;

export async function kleinunternehmerInYear(year: number, q: Db | Tx = db): Promise<KleinunternehmerInMonth> {
  const history = await kleinunternehmerHistory(q);
  return (month) => history(lastDayOfMonth(year, month));
}

/**
 * Privatnutzung eines Jahres: Monate, Entnahme und Umsatzsteuer je Monat; in Monaten als Kleinunternehmer ohne
 * Umsatzsteuer (§ 19 UStG). privateUse.vat steht seit dem Anlegen fest, ein späterer Wechsel gilt trotzdem.
 */
function privateUseForYear(asset: Asset, year: number, kleinunternehmer: KleinunternehmerInMonth = () => false) {
  if (!asset.privateUse) return null;
  const months = privateUseMonths(asset, year);
  const regular = privateUseMonth(asset.privateUse);
  const withoutVat = privateUseMonth({ ...asset.privateUse, vat: false });
  const byMonth = months.map((m) => (kleinunternehmer(m) ? withoutVat : regular));
  return {
    months,
    byMonth,
    withdrawal: byMonth.reduce((sum, m) => sum + m.withdrawal, 0),
    vatBase: byMonth.reduce((sum, m) => sum + m.vatBase, 0),
    vat: byMonth.reduce((sum, m) => sum + m.vat, 0),
  };
}

/** Was im Jahr zu buchen ist: AfA laut Plan und Privatnutzung */
export function yearPlan(asset: Asset, year: number, kleinunternehmer?: KleinunternehmerInMonth) {
  const row = scheduleOf(asset, year).find((r) => r.year === year) ?? null;
  const privateUse = privateUseForYear(asset, year, kleinunternehmer);
  const hasWork = Boolean((row && (row.depreciation !== 0 || row.disposal !== 0)) || (privateUse && privateUse.withdrawal !== 0));
  return { row, privateUse, hasWork };
}

async function bookedYears(ids: string[], q: Db | Tx = db): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const rows = await q
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
export async function listAssets(year: number, q: Db | Tx = db) {
  const assets = await q.select().from(schema.assets).orderBy(asc(schema.assets.acquisitionDate), asc(schema.assets.name));
  const booked = await bookedYears(
    assets.map((a) => a.id),
    q,
  );
  const kleinunternehmer = await kleinunternehmerInYear(year, q);
  return assets.map((asset) => {
    const schedule = scheduleOf(asset, year);
    const row = schedule.find((r) => r.year === year) ?? null;
    const first = schedule[0]?.year ?? Number(asset.acquisitionDate.slice(0, 4));
    // Nach dem Plan: Buchwert 0 bzw. vor Beginn kein Eintrag; zur Anzeige den Stand am Jahresende
    const closing = row?.closing ?? (year < first ? null : 0);
    const years = booked.get(asset.id) ?? [];
    const plan = yearPlan(asset, year, kleinunternehmer);
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
    schedule: scheduleOf(asset, currentYear()),
    bookedYears: booked.sort((a, b) => a - b),
  };
}

/** Übernimmt eine Anlage mit Restbuchwert zum Stichtag. */
export async function createAsset(actor: string, input: AssetInput): Promise<Asset> {
  return withActor(actor, (tx) => insertAsset(tx, input));
}

/** Übernimmt eine Anlage in der laufenden Transaktion; auch für den CSV-Import, der alle Zeilen in einer Transaktion anlegt */
export async function insertAsset(tx: Tx, input: AssetInput): Promise<Asset> {
  // Anlagekonto und Umsatzsteuer auf die Privatnutzung nach den Firmendaten in derselben Transaktion
  const company = await loadCompany(tx);
  const values = {
    ...input,
    ...methodValues(input.method, input),
    privateUse: privateUseValue(input.kind, input.privateUse ?? null, company),
    account: assetAccount(input.kind, input.method, company.kontenrahmen),
  };
  const issues = [...assetIssues(scheduleInput({ ...values, openingEntryId: null } as Asset)), ...elektroIssues(values, company.rechtsform)];
  if (issues.length > 0) throw new AssetUserError(`${issues.join(", ")}.`);
  const [created] = await tx.insert(schema.assets).values(values).returning();
  return created!;
}

/**
 * Ändert eine Anlage. Ist schon etwas gebucht, gehen nur Bezeichnung, Notiz, der Abgang und bei degressiver AfA der
 * Wechsel zur linearen, beide nur in ein Jahr, für das noch keine AfA gebucht ist.
 */
export async function updateAsset(actor: string, id: string, input: z.infer<typeof assetUpdateSchema>): Promise<Asset> {
  return withActor(actor, async (tx) => {
    const [asset] = await tx.select().from(schema.assets).where(eq(schema.assets.id, id)).for("update");
    if (!asset) throw new AssetUserError("Anlage nicht gefunden.");
    const company = await loadCompany(tx);
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
      for (const key of ["degressiveRate", "linearFromYear", "memoValue"] as const) {
        if (input[key] !== undefined) (next as Record<string, unknown>)[key] = input[key];
      }
      Object.assign(next, methodValues(next.method, next));
      if (input.privateUse !== undefined) next.privateUse = privateUseValue(next.kind, input.privateUse, company);
    } else {
      if (input.privateUse !== undefined && !samePrivateUse(input.privateUse, asset.privateUse)) {
        throw new AssetUserError("Für die Anlage ist schon gebucht; die Privatnutzung lässt sich nicht mehr ändern.");
      }
      if (input.linearFromYear !== undefined && input.linearFromYear !== asset.linearFromYear) {
        const problem = switchToLinearProblem(asset, input.linearFromYear, lastBooked);
        if (problem) throw new AssetUserError(problem);
        next.linearFromYear = input.linearFromYear;
      }
    }

    const issues = [...assetIssues(scheduleInput(next)), ...elektroIssues(next, company.rechtsform)];
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

/**
 * Privatnutzung nur bei Fahrzeugen und nur im Einzelunternehmen; Kleinunternehmer zahlen keine Umsatzsteuer darauf.
 * Fährt der Gesellschafter einen Wagen der GmbH privat, ist das Arbeitslohn (Sachbezug), keine Entnahme.
 */
function privateUseValue(kind: Asset["kind"], value: CarPrivateUse | null, company: Pick<Company, "kleinunternehmer" | "rechtsform">): CarPrivateUse | null {
  if (!value) return null;
  if (isKapitalgesellschaft(company.rechtsform)) throw new AssetUserError("Privatnutzung als Entnahme gibt es nur im Einzelunternehmen.");
  if (kind !== "kfz") throw new AssetUserError("Privatnutzung nach der Listenpreismethode gibt es nur für Fahrzeuge.");
  return { ...value, vat: value.vat && !company.kleinunternehmer };
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

/** Abschreibungen eines Jahres für die EÜR, aus dem Plan (gebucht oder nicht) */
export async function depreciationForEuer(year: number, q: Db | Tx = db): Promise<EuerDepreciation> {
  const assets = await q.select().from(schema.assets);
  const result: EuerDepreciation = {
    afa: 0,
    gwg: 0,
    sammelposten: 0,
    restbuchwert: 0,
  };
  for (const asset of assets) {
    const row = scheduleOf(asset, year).find((r) => r.year === year);
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
export async function withdrawalsForEuer(year: number, q: Db | Tx = db): Promise<EuerWithdrawals> {
  const assets = await q.select().from(schema.assets);
  const result: EuerWithdrawals = { privateKfz: 0, ustEntnahmen: 0 };
  const kleinunternehmer = await kleinunternehmerInYear(year, q);
  for (const asset of assets) {
    const use = privateUseForYear(asset, year, kleinunternehmer);
    if (!use) continue;
    result.privateKfz += use.withdrawal;
    result.ustEntnahmen += use.vat;
  }
  return result;
}

/** Private Kfz-Nutzung eines Monats für die Voranmeldung (Kz 81), je Fahrzeug */
export async function privateUseForMonth(year: number, month: number, q: Db | Tx = db) {
  const assets = await q.select().from(schema.assets);
  const kleinunternehmer = await kleinunternehmerInYear(year, q);
  return assets.flatMap((asset) => {
    const use = privateUseForYear(asset, year, kleinunternehmer);
    const index = use?.months.indexOf(month) ?? -1;
    const used = index >= 0 ? use!.byMonth[index]! : null;
    if (!used || used.vatBase === 0) return [];
    return [
      {
        assetId: asset.id,
        name: asset.name,
        base: used.vatBase,
        tax: used.vat,
      },
    ];
  });
}
