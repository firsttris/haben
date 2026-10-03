import {
  ACCOUNTS,
  fahrtBetrag,
  FAHRZEUG_LABEL,
  homeofficeSatz,
  PAUSCHALE_KONTEN,
  PAUSCHALE_LABEL,
  REISETAG_LABEL,
  verpflegungBetrag,
  type Cents,
  type PauschaleArt,
} from "@haben/core";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";

/**
 * Pauschalen ohne Beleg: Homeoffice-Tagespauschale je Monat, Fahrten mit dem Privatfahrzeug und
 * Verpflegungsmehraufwand je Reisetag. Jede Pauschale ist eine festgeschriebene Buchung Aufwand an
 * Privateinlage; aufgehoben wird per Storno (Gegenzeile und Gegenbuchung).
 */

export class PauschaleError extends Error {}

export type Pauschale = typeof schema.pauschalen.$inferSelect;

/** Eine Transaktion zur Zeit legt Pauschalen an oder storniert sie, damit die Höchstzahl der Homeoffice-Tage hält */
const sqlLock = sql`select pg_advisory_xact_lock(hashtext('haben.pauschalen'))`;

const isoDate = z.iso.date();
const description = z.string().trim().max(300);

export const pauschaleInputSchema = z.discriminatedUnion("art", [
  z.object({
    art: z.literal("homeoffice"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat fehlt"),
    tage: z.number().int().min(1, "Mindestens ein Tag").max(31),
    description: description.default(""),
  }),
  z.object({
    art: z.literal("fahrt"),
    date: isoDate,
    description: description.min(1, "Anlass und Ziel fehlen"),
    km: z.number().positive("Kilometer fehlen").max(5000),
    fahrzeug: z.enum(["pkw", "andere"]),
    hinUndZurueck: z.boolean().default(true),
  }),
  z.object({
    art: z.literal("verpflegung"),
    date: isoDate,
    description: description.min(1, "Anlass und Ort fehlen"),
    tag: z.enum(["eintaegig", "anreise", "abreise", "ganztag"]),
    fruehstueck: z.boolean().default(false),
    mittag: z.boolean().default(false),
    abend: z.boolean().default(false),
  }),
]);

export type PauschaleInput = z.input<typeof pauschaleInputSchema>;

const lastDayOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const daysInMonth = (month: string) => Number(lastDayOfMonth(month).slice(8, 10));

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

const germanMonth = (month: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

const formatKm = (km: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(km);

/** Homeoffice-Tage eines Jahres bzw. Monats nach Storno (Stornozeilen zählen negativ) */
async function homeofficeTage(tx: Tx, from: string, to: string): Promise<number> {
  const rows = await tx
    .select({ amount: schema.pauschalen.amount, details: schema.pauschalen.details })
    .from(schema.pauschalen)
    .where(and(eq(schema.pauschalen.art, "homeoffice"), gte(schema.pauschalen.date, from), lt(schema.pauschalen.date, to)));
  return rows.reduce((sum, r) => sum + Math.sign(r.amount) * Number(r.details.tage ?? 0), 0);
}

interface Prepared {
  art: PauschaleArt;
  date: string;
  description: string;
  details: Record<string, string | number | boolean>;
  amount: Cents;
  /** Buchungstext */
  text: string;
}

async function prepare(tx: Tx, input: z.output<typeof pauschaleInputSchema>, today: string): Promise<Prepared> {
  switch (input.art) {
    case "homeoffice": {
      const year = Number(input.month.slice(0, 4));
      const satz = homeofficeSatz(year);
      if (!satz) throw new PauschaleError("Die Homeoffice-Pauschale gibt es erst ab 2020.");
      if (input.month > today.slice(0, 7)) throw new PauschaleError("Der Monat liegt in der Zukunft.");
      const date = lastDayOfMonth(input.month);
      const imMonat = await homeofficeTage(tx, `${input.month}-01`, `${nextMonth(input.month)}-01`);
      if (imMonat + input.tage > daysInMonth(input.month)) {
        throw new PauschaleError(`Der ${germanMonth(input.month)} hat nur ${daysInMonth(input.month)} Tage; eingetragen sind schon ${imMonat}.`);
      }
      const imJahr = await homeofficeTage(tx, `${year}-01-01`, `${year + 1}-01-01`);
      if (imJahr + input.tage > satz.maxTage) {
        throw new PauschaleError(`Für ${year} gibt es die Pauschale für höchstens ${satz.maxTage} Tage; eingetragen sind schon ${imJahr}.`);
      }
      return {
        art: "homeoffice",
        date,
        description: input.description,
        details: { tage: input.tage },
        amount: input.tage * satz.proTag,
        text: `Homeoffice ${germanMonth(input.month)}: ${input.tage} Tag${input.tage === 1 ? "" : "e"}`,
      };
    }
    case "fahrt": {
      if (input.date > today) throw new PauschaleError("Das Datum liegt in der Zukunft.");
      const km = Math.round(input.km * 10) / 10;
      const gesamt = Math.round((input.hinUndZurueck ? km * 2 : km) * 10) / 10;
      return {
        art: "fahrt",
        date: input.date,
        description: input.description,
        details: { km, fahrzeug: input.fahrzeug, hinUndZurueck: input.hinUndZurueck },
        amount: fahrtBetrag(gesamt, input.fahrzeug),
        text: `Fahrt ${input.description}: ${formatKm(gesamt)} km ${FAHRZEUG_LABEL[input.fahrzeug]}`,
      };
    }
    case "verpflegung": {
      if (input.date > today) throw new PauschaleError("Das Datum liegt in der Zukunft.");
      const mahlzeiten = { fruehstueck: input.fruehstueck, mittag: input.mittag, abend: input.abend };
      const amount = verpflegungBetrag(Number(input.date.slice(0, 4)), input.tag, mahlzeiten);
      if (amount === 0) throw new PauschaleError("Nach Abzug der gestellten Mahlzeiten bleibt keine Pauschale.");
      return {
        art: "verpflegung",
        date: input.date,
        description: input.description,
        details: { tag: input.tag, ...mahlzeiten },
        amount,
        text: `Verpflegung ${input.description}: ${REISETAG_LABEL[input.tag]}`,
      };
    }
  }
}

async function postEntry(
  tx: Tx,
  input: { id: string; art: PauschaleArt; date: string; text: string; amount: Cents; reversesId?: string | null },
): Promise<string> {
  const { kontenrahmen } = await loadCompany();
  const aufwand = PAUSCHALE_KONTEN[input.art][kontenrahmen].konto;
  const einlage = ACCOUNTS[kontenrahmen].privateinlagen;
  const [entry] = await tx
    .insert(schema.journalEntries)
    .values({
      date: input.date,
      description: input.text,
      sourceType: "pauschale",
      sourceId: input.id,
      kontenrahmen,
      reversesId: input.reversesId ?? null,
    })
    .returning();
  const [soll, haben] = input.amount >= 0 ? [aufwand, einlage] : [einlage, aufwand];
  const betrag = Math.abs(input.amount);
  await tx.insert(schema.journalLines).values([
    { entryId: entry!.id, account: soll, debit: betrag, credit: 0, taxCode: null },
    { entryId: entry!.id, account: haben, debit: 0, credit: betrag, taxCode: null },
  ]);
  await tx.update(schema.journalEntries).set({ lockedAt: new Date() }).where(eq(schema.journalEntries.id, entry!.id));
  return entry!.id;
}

/** Trägt eine Pauschale ein und bucht sie */
export async function createPauschale(actor: string, input: PauschaleInput, today: string): Promise<Pauschale> {
  const parsed = pauschaleInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    await tx.execute(sqlLock);
    const p = await prepare(tx, parsed, today);
    const id = crypto.randomUUID();
    const journalEntryId = await postEntry(tx, { id, art: p.art, date: p.date, text: p.text, amount: p.amount });
    const [row] = await tx
      .insert(schema.pauschalen)
      .values({ id, art: p.art, date: p.date, description: p.description, details: p.details, amount: p.amount, journalEntryId })
      .returning();
    return row!;
  });
}

/** Hebt eine Pauschale per Gegenzeile und Gegenbuchung am selben Tag auf */
export async function reversePauschale(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sqlLock);
    const [original] = await tx.select().from(schema.pauschalen).where(eq(schema.pauschalen.id, id));
    if (!original || original.reversesId) throw new PauschaleError("Pauschale nicht gefunden.");
    const [already] = await tx.select({ id: schema.pauschalen.id }).from(schema.pauschalen).where(eq(schema.pauschalen.reversesId, id));
    if (already) throw new PauschaleError("Die Pauschale ist bereits storniert.");
    const [entry] = await tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, original.journalEntryId));
    const reversalId = crypto.randomUUID();
    const journalEntryId = await postEntry(tx, {
      id: reversalId,
      art: original.art,
      date: original.date,
      text: `Storno: ${entry?.description ?? PAUSCHALE_LABEL[original.art]}`,
      amount: -original.amount,
      reversesId: original.journalEntryId,
    });
    await tx.insert(schema.pauschalen).values({
      id: reversalId,
      art: original.art,
      date: original.date,
      description: original.description,
      details: original.details,
      amount: -original.amount,
      reversesId: original.id,
      journalEntryId,
    });
  });
}

/** Pauschalen eines Jahres, neueste zuerst, mit Summen je Art und den Homeoffice-Tagen */
export async function listPauschalen(year: number) {
  const rows = await db
    .select()
    .from(schema.pauschalen)
    .where(and(gte(schema.pauschalen.date, `${year}-01-01`), lt(schema.pauschalen.date, `${year + 1}-01-01`)))
    .orderBy(asc(schema.pauschalen.date), asc(schema.pauschalen.createdAt));
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  const active = rows.filter((r) => !r.reversesId && !reversed.has(r.id));
  const sum = (art: PauschaleArt) => active.filter((r) => r.art === art).reduce((s, r) => s + r.amount, 0);
  const satz = homeofficeSatz(year);
  return {
    year,
    entries: rows
      .filter((r) => !r.reversesId)
      .map((r) => ({ ...r, storniert: reversed.has(r.id) }))
      .reverse(),
    totals: { homeoffice: sum("homeoffice"), fahrt: sum("fahrt"), verpflegung: sum("verpflegung") },
    homeoffice: {
      tage: active.filter((r) => r.art === "homeoffice").reduce((s, r) => s + Number(r.details.tage ?? 0), 0),
      maxTage: satz?.maxTage ?? 0,
      proTag: satz?.proTag ?? 0,
    },
  };
}
