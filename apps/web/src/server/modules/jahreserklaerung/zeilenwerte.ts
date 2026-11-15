import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { zeilenFelder, zeilenForm, type ZeilenForm } from "../../../lib/zeilenwerte.ts";
import { AnnualError } from "./fehler.ts";

/*
 * Erklärte Zeilenwerte: Eine Jahreserklärung, die außerhalb von Haben abgegeben wurde, hat Zeilen, die
 * Haben aus den Buchungen nicht rechnen kann. Sie stehen im Übermittlungsprotokoll und werden hier am
 * Vermerk erfasst (#997).
 *
 * Die Tabelle hängt neben `annual_submissions`, nicht darin: der Vermerk ist `append_only`, ein späteres
 * UPDATE scheitert also.
 */

/** Ein Betrag in Cent; die Grenze hält einen Tippfehler davon ab, die Summe zu sprengen */
const zeilenBetrag = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

export const zeilenwerteSchema = z.object({
  form: zeilenForm,
  year: z.number().int(),
  // Leere Felder kommen nicht mit; ein bewusst eingetragenes Feld mit 0 schon
  zeilen: z.array(z.object({ field: z.string().trim().min(1), amount: zeilenBetrag })).max(64),
});

/**
 * Erfasst die Zeilenwerte zu einem vorhandenen Vermerk. Ohne Vermerk gibt es keine Erklärung, zu der sie
 * gehören, und ohne bekannte Zeile wäre die Anzeige nicht zuordenbar. Ein abgeschlossenes Jahr bleibt
 * unverändert und nimmt keine Zeilen mehr auf, wie es keinen Vermerk mehr aufnimmt (vermerk.ts).
 */
export async function speichereErklaerteZeilen(
  actor: string,
  form: ZeilenForm,
  year: number,
  zeilen: readonly { field: string; amount: number }[],
): Promise<number> {
  if (zeilen.length === 0) throw new AnnualError("Es sind keine Zeilenwerte angegeben.");

  const erlaubt = new Set(zeilenFelder(form));
  const unbekannt = zeilen.find((z) => !erlaubt.has(z.field));
  if (unbekannt) throw new AnnualError(`Diese Zeile gehört nicht zu dieser Erklärung: ${unbekannt.field}`);

  const gesehen = new Set<string>();
  for (const z of zeilen) {
    if (gesehen.has(z.field)) throw new AnnualError(`Diese Zeile steht doppelt: ${z.field}`);
    gesehen.add(z.field);
  }

  const [vermerk] = await db
    .select({ id: schema.annualSubmissions.id })
    .from(schema.annualSubmissions)
    .where(
      and(
        eq(schema.annualSubmissions.form, form),
        eq(schema.annualSubmissions.year, year),
        eq(schema.annualSubmissions.kind, "vermerk"),
        eq(schema.annualSubmissions.ok, true),
      ),
    )
    .limit(1);
  if (!vermerk) throw new AnnualError("Für dieses Jahr gibt es keinen Vermerk, zu dem die Zeilen gehören.");

  await withActor(actor, async (tx) => {
    // Ein abgeschlossenes Jahr bleibt unverändert (wie beim Vermerk, vermerk.ts): die Zeilen sind Steuerdaten
    const [closed] = await tx.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, year));
    if (closed) throw new AnnualError(`Das Jahr ${year} ist abgeschlossen; erklärte Zeilen lassen sich nicht mehr erfassen.`);
    // Gespeicherte Zeilen sind nur anhängbar; eine zweite Erfassung derselben Zeile wäre sonst ein Datenbankfehler
    const vorhanden = await tx
      .select({ field: schema.annualSubmissionFigures.field })
      .from(schema.annualSubmissionFigures)
      .where(and(eq(schema.annualSubmissionFigures.submissionId, vermerk.id), inArray(schema.annualSubmissionFigures.field, [...gesehen])));
    if (vorhanden.length > 0)
      throw new AnnualError(`Diese Zeile ist schon gespeichert und lässt sich nicht ändern: ${vorhanden.map((v) => v.field).join(", ")}`);
    await tx.insert(schema.annualSubmissionFigures).values(zeilen.map((z) => ({ submissionId: vermerk.id, field: z.field, amount: z.amount })));
  });
  return zeilen.length;
}

/**
 * Zeilenwerte, die außerhalb von Haben erklärt wurden, je Schlüssel der Erklärung (`steuerpflichtig`,
 * `base19`, `gewinn`, …). Leer, wenn zu diesem Vermerk nichts erfasst ist.
 *
 * Sie stehen neben dem Vermerk, nicht darin: `annual_submissions` ist `append_only`, ein späteres UPDATE
 * scheitert also (#997).
 */
export async function erklaerteZeilen(submissionId: string | null): Promise<Record<string, number>> {
  if (!submissionId) return {};
  const rows = await db
    .select({ field: schema.annualSubmissionFigures.field, amount: schema.annualSubmissionFigures.amount })
    .from(schema.annualSubmissionFigures)
    .where(eq(schema.annualSubmissionFigures.submissionId, submissionId));
  return Object.fromEntries(rows.map((r) => [r.field, r.amount]));
}
