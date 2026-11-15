import { formatEuro } from "@haben/core";
import { ERSTES_ERKLAERUNGSJAHR } from "@haben/elster";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { AnnualError } from "./fehler.ts";

/*
 * Der Steuerbescheid zur Einkommensteuererklärung (#1073). Das Übermittlungsprotokoll nennt keinen Steuerbetrag; er
 * entsteht erst mit dem Bescheid. Der Vermerk belegt die Abgabe, der Bescheid hält das Ergebnis fest — als eigener
 * angehängter Eintrag neben ihm, ohne die Erklärung oder den Vermerk anzufassen.
 */

/** Betrag in Cent, mit derselben Grenze wie der Vermerk */
const betrag = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

/** Felder des Bescheids; Beträge in Cent wie überall in Haben */
export const bescheidFelder = {
  bescheidVom: z.iso.date("Bitte das Datum des Bescheids angeben."),
  festgesetzteSteuer: betrag.optional(),
  erstattung: betrag.optional(),
  nachzahlung: betrag.optional(),
  aktenzeichen: z.string().trim().max(80, "Das Aktenzeichen ist zu lang.").optional(),
  note: z.string().trim().max(2000, "Die Notiz ist zu lang.").optional(),
};

export const bescheidSchema = z.object(bescheidFelder);

export interface Bescheid {
  year: number;
  bescheidVom: string;
  festgesetzteSteuer: number | null;
  erstattung: number | null;
  nachzahlung: number | null;
  aktenzeichen: string | null;
  note: string | null;
  createdAt: Date;
}

/** Was gegen die Eingaben spricht, das ohne Datenbank prüfbar ist, oder null */
export function bescheidProblem(data: z.infer<typeof bescheidSchema>, heute: string): string | null {
  if (data.bescheidVom > heute) return "Der Bescheid liegt in der Zukunft.";
  if (data.erstattung !== undefined && data.nachzahlung !== undefined) return "Ein Bescheid ist entweder eine Erstattung oder eine Nachzahlung, nicht beides.";
  if (data.erstattung === undefined && data.nachzahlung === undefined && data.festgesetzteSteuer === undefined)
    return "Bitte mindestens die festgesetzte Steuer oder die Erstattung bzw. Nachzahlung eintragen.";
  return null;
}

/**
 * Trägt den Steuerbescheid zur Einkommensteuererklärung eines Jahres nach. Voraussetzung ist der Vermerk der Abgabe:
 * Ohne ihn weiß Haben nicht, dass das Jahr erledigt ist. Je Jahr ein Bescheid; ein geänderter Bescheid braucht einen
 * eigenen Weg, weil die Zeile wie der Vermerk anhängend ist.
 */
export async function bescheidErfassen(actor: string, year: number, input: z.infer<typeof bescheidSchema>, heute = today()): Promise<Bescheid> {
  const parsed = bescheidSchema.safeParse(input);
  if (!parsed.success) throw new AnnualError(parsed.error.issues[0]?.message ?? "Angaben unvollständig.");
  const data = parsed.data;
  const problem = bescheidProblem(data, heute);
  if (problem) throw new AnnualError(problem);
  if (year >= Number(heute.slice(0, 4))) throw new AnnualError("Ein Bescheid liegt erst nach Ablauf des Jahres vor.");
  if (year < ERSTES_ERKLAERUNGSJAHR) throw new AnnualError(`Jahreserklärungen gibt es ab ${ERSTES_ERKLAERUNGSJAHR}.`);

  const [vermerk] = await db
    .select({ id: schema.annualSubmissions.id, filedOn: schema.annualSubmissions.filedOn })
    .from(schema.annualSubmissions)
    .where(and(eq(schema.annualSubmissions.form, "est"), eq(schema.annualSubmissions.year, year), eq(schema.annualSubmissions.kind, "vermerk")));
  if (!vermerk) throw new AnnualError(`Zur Einkommensteuererklärung ${year} ist keine Abgabe vermerkt; der Bescheid gehört zu einer abgegebenen Erklärung.`);
  if (vermerk.filedOn && data.bescheidVom < vermerk.filedOn) throw new AnnualError("Der Bescheid liegt vor dem Tag der Abgabe; das kann nicht sein.");

  const [schonDa] = await db
    .select({ id: schema.annualSubmissions.id })
    .from(schema.annualSubmissions)
    .where(
      and(eq(schema.annualSubmissions.form, "est"), eq(schema.annualSubmissions.year, year), sql`${schema.annualSubmissions.figures}->>'art' = 'bescheid'`),
    );
  if (schonDa) throw new AnnualError(`Für ${year} ist schon ein Bescheid erfasst.`);

  const figures = {
    art: "bescheid",
    bescheidVom: data.bescheidVom,
    ...(data.festgesetzteSteuer === undefined ? {} : { festgesetzteSteuer: data.festgesetzteSteuer }),
    ...(data.erstattung === undefined ? {} : { erstattung: data.erstattung }),
    ...(data.nachzahlung === undefined ? {} : { nachzahlung: data.nachzahlung }),
    ...(data.aktenzeichen ? { aktenzeichen: data.aktenzeichen } : {}),
  };

  await withActor(actor, async (tx) => {
    await tx.insert(schema.annualSubmissions).values({
      form: "est",
      year,
      kind: "bescheid",
      ok: true,
      code: 0,
      message: "Bescheid erfasst",
      note: data.note ?? null,
      figures,
      requestXml: "",
      responseXml: "",
      serverResponseXml: "",
    });
  });

  return {
    year,
    bescheidVom: data.bescheidVom,
    festgesetzteSteuer: data.festgesetzteSteuer ?? null,
    erstattung: data.erstattung ?? null,
    nachzahlung: data.nachzahlung ?? null,
    aktenzeichen: data.aktenzeichen ?? null,
    note: data.note ?? null,
    createdAt: new Date(),
  };
}

/** Der erfasste Bescheid eines Jahres, oder null */
export async function bescheidFuerJahr(year: number): Promise<Bescheid | null> {
  const [row] = await db
    .select({
      figures: schema.annualSubmissions.figures,
      note: schema.annualSubmissions.note,
      createdAt: schema.annualSubmissions.createdAt,
    })
    .from(schema.annualSubmissions)
    .where(
      and(eq(schema.annualSubmissions.form, "est"), eq(schema.annualSubmissions.year, year), sql`${schema.annualSubmissions.figures}->>'art' = 'bescheid'`),
    )
    .orderBy(desc(schema.annualSubmissions.createdAt))
    .limit(1);
  if (!row) return null;
  const f = row.figures as Record<string, unknown>;
  const betrag = (key: string) => (typeof f[key] === "number" ? (f[key] as number) : null);
  return {
    year,
    bescheidVom: String(f.bescheidVom ?? ""),
    festgesetzteSteuer: betrag("festgesetzteSteuer"),
    erstattung: betrag("erstattung"),
    nachzahlung: betrag("nachzahlung"),
    aktenzeichen: typeof f.aktenzeichen === "string" ? f.aktenzeichen : null,
    note: row.note,
    createdAt: row.createdAt,
  };
}

/** Ein Satz für die Jahresübersicht: was im Bescheid steht, in Worten */
export function bescheidText(b: Bescheid): string {
  const teile: string[] = [`Bescheid vom ${b.bescheidVom}`];
  if (b.festgesetzteSteuer !== null) teile.push(`festgesetzte Steuer ${formatEuro(b.festgesetzteSteuer)}`);
  if (b.erstattung !== null) teile.push(`Erstattung ${formatEuro(b.erstattung)}`);
  if (b.nachzahlung !== null) teile.push(`Nachzahlung ${formatEuro(b.nachzahlung)}`);
  if (b.aktenzeichen) teile.push(`Aktenzeichen ${b.aktenzeichen}`);
  return teile.join(" · ");
}
