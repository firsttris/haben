import { isValidIdnr, type EstAngaben } from "@haben/elster";
import { kirchensteuerpflichtig, steuerPrognose, type Cents, type Prognose } from "@haben/core";
import { desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

/** Betrag in Cent, nicht negativ */
const cents = z.number().int().min(0).max(100_000_000_00).optional();
const isoDate = z.iso.date("Gültiges Datum im Format JJJJ-MM-TT");

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

const tage = z.number().int().min(0).max(366).optional();

const bescheinigung = z.object({
  steuerklasse: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  brutto: z.number().int().min(1, "Bruttoarbeitslohn fehlt").max(100_000_000_00),
  lohnsteuer: cents,
  soli: cents,
  kirchensteuer: cents,
  kirchensteuerEhegatte: cents,
  rvArbeitgeber: cents,
  rvArbeitnehmer: cents,
  kvArbeitnehmer: cents,
  pvArbeitnehmer: cents,
  avArbeitnehmer: cents,
});

const arbeitnehmer = z.object({
  bescheinigungen: z.array(bescheinigung).max(10).default([]),
  werbungskosten: z
    .object({
      wege: z
        .object({
          tage: z.number().int().min(1).max(366),
          km: z.number().min(1).max(9999),
          adresse: z.string().trim().min(1, "Anschrift der Tätigkeitsstätte fehlt").max(200),
          arbeitstageJeWoche: z.number().int().min(1).max(7).optional(),
          urlaubstage: tage,
        })
        .optional(),
      homeofficeTage: tage,
      keinAndererArbeitsplatz: z.boolean().optional(),
      arbeitsmittel: cents,
      fortbildung: cents,
      berufsverbaende: cents,
      gewerkschaft: cents,
      sonstige: cents,
    })
    .default({}),
});

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
          .refine((v) => v === "" || isValidIdnr(v), "Die Identifikationsnummer ist ungültig (11 Ziffern mit Prüfziffer)")
          .optional(),
        vorname: z.string().trim().min(1, "Vorname des Kindes fehlt").max(100),
        name: z.string().trim().max(100).optional(),
        geburtsdatum: isoDate,
        familienkasse: z.string().trim().min(1, "Für jedes Kind braucht ELSTER die zuständige Familienkasse.").max(100),
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
  arbeitnehmer: z.object({ a: arbeitnehmer.optional(), b: arbeitnehmer.optional() }).optional(),
});

export type EstAngabenInput = z.input<typeof estAngabenSchema>;

const EMPTY: EstAngaben = { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] };

export async function loadEstAngaben(year: number): Promise<EstAngaben> {
  const [row] = await db.select({ data: schema.incomeTaxInputs.data }).from(schema.incomeTaxInputs).where(eq(schema.incomeTaxInputs.year, year));
  if (!row) return EMPTY;
  const parsed = estAngabenSchema.safeParse(row.data);
  if (parsed.success) return parsed.data as EstAngaben;
  // Gespeichert wurde über dasselbe Schema; passt es nach einer Verschärfung nicht mehr, die Angaben nicht verwerfen
  console.warn(`Angaben zur Einkommensteuer ${year} passen nicht zum Schema:\n${z.prettifyError(parsed.error)}`);
  return { ...EMPTY, ...(row.data as Partial<EstAngaben>) };
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
