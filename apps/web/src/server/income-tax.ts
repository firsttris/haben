import type { EstAngaben } from "@haben/elster";
import { kirchensteuerpflichtig, steuerPrognose, type Cents, type Prognose } from "@haben/core";
import { desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

/** Betrag in Cent, nicht negativ */
const cents = z.number().int().min(0).max(100_000_000_00).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");

const vorsorgePerson = z
  .object({
    rentenversicherung: cents,
    gkv: cents,
    gpv: cents,
    gkvZusatz: cents,
    pkv: cents,
    ppv: cents,
    pkvErstattung: cents,
  })
  .default({});

export const estAngabenSchema = z.object({
  vorsorge: z.object({ a: vorsorgePerson, b: vorsorgePerson.optional(), sonstige: cents }).default({ a: {} }),
  sonderausgaben: z.object({ kirchensteuerGezahlt: cents, kirchensteuerErstattet: cents, spenden: cents }).default({}),
  krankheitskosten: cents,
  haushaltsnah: z.object({ minijobs: cents, dienstleistungen: cents, handwerker: cents }).default({}),
  kinder: z
    .array(
      z.object({
        idnr: z
          .string()
          .trim()
          .transform((v) => v.replace(/\s+/g, ""))
          .refine((v) => v === "" || /^\d{11}$/.test(v), "Die Identifikationsnummer hat 11 Ziffern")
          .optional(),
        vorname: z.string().trim().min(1, "Vorname des Kindes fehlt").max(100),
        name: z.string().trim().max(100).optional(),
        geburtsdatum: isoDate,
        familienkasse: z.string().trim().max(100).optional(),
        kinderbetreuung: cents,
      }),
    )
    .max(15)
    .default([]),
  kap: z
    .object({
      guenstigerpruefung: z.boolean().optional(),
      ertraegeMitSteuerabzug: cents,
      sparerPauschbetrag: cents,
      ertraegeOhneSteuerabzugInland: cents,
      ertraegeAusland: cents,
      kapitalertragsteuer: cents,
      soli: cents,
      kirchensteuer: cents,
    })
    .optional(),
});

export type EstAngabenInput = z.input<typeof estAngabenSchema>;

const EMPTY: EstAngaben = { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] };

export async function loadEstAngaben(year: number): Promise<EstAngaben> {
  const [row] = await db.select({ data: schema.incomeTaxInputs.data }).from(schema.incomeTaxInputs).where(eq(schema.incomeTaxInputs.year, year));
  if (!row) return EMPTY;
  const parsed = estAngabenSchema.safeParse(row.data);
  return parsed.success ? (parsed.data as EstAngaben) : EMPTY;
}

/** Angaben des Jahres, sonst die des Vorjahres als Schätzung (z. B. für die Prognose im laufenden Jahr) */
export async function latestEstAngaben(year: number): Promise<{ angaben: EstAngaben; fromYear: number | null }> {
  const [row] = await db
    .select({ year: schema.incomeTaxInputs.year })
    .from(schema.incomeTaxInputs)
    .where(lte(schema.incomeTaxInputs.year, year))
    .orderBy(desc(schema.incomeTaxInputs.year))
    .limit(1);
  if (!row || row.year < year - 1) return { angaben: EMPTY, fromYear: null };
  return { angaben: await loadEstAngaben(row.year), fromYear: row.year };
}

/** Steuerprognose aus Gewinn, Veranlagung, Religion und Angaben */
export async function prognose(year: number, gewinn: Cents, angaben: EstAngaben): Promise<Prognose> {
  const company = await loadCompany();
  const t = company.taxpayer;
  const zusammen = t.veranlagung === "zusammen" && Boolean(t.b);
  return steuerPrognose({
    year,
    gewinn,
    zusammen,
    kirche: { a: kirchensteuerpflichtig(t.a?.religion), b: zusammen && kirchensteuerpflichtig(t.b?.religion) },
    bundesland: company.bundesland,
    angaben,
  });
}

export async function saveEstAngaben(actor: string, year: number, input: EstAngabenInput): Promise<EstAngaben> {
  const data = estAngabenSchema.parse(input) as EstAngaben;
  await withActor(actor, (tx) =>
    tx
      .insert(schema.incomeTaxInputs)
      .values({ year, data: data as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: schema.incomeTaxInputs.year, set: { data: data as unknown as Record<string, unknown>, updatedAt: new Date() } }),
  );
  return data;
}
