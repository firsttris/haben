import { angabenZumBetrieb } from "@firsttris/gobd-kern/verfahrensdoku";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";

/**
 * Angaben zum Betrieb, die Haben nicht aus eigenen Daten kennt (#860). Firma, Rechtsform und Anschrift stehen in den
 * Firmendaten und kommen von dort; das Schema der übrigen Felder ist das gemeinsame aus @firsttris/gobd-kern.
 */
export const procedureDetailsSchema = angabenZumBetrieb.pick({
  verantwortlich: true,
  datensicherung: true,
  aufbewahrungsort: true,
  papierbelege: true,
  serverbetrieb: true,
  schluesselablage: true,
  ergaenzungen: true,
});

export type ProcedureDetails = z.infer<typeof procedureDetailsSchema>;

const PROCEDURE_FIELDS = Object.keys(procedureDetailsSchema.shape) as (keyof ProcedureDetails)[];

const EMPTY: ProcedureDetails = Object.fromEntries(PROCEDURE_FIELDS.map((name) => [name, ""])) as ProcedureDetails;

export async function loadProcedureDetails(): Promise<ProcedureDetails & { updatedAt: Date | null }> {
  const [row] = await db.select().from(schema.procedureDetails).where(eq(schema.procedureDetails.id, 1));
  if (!row) return { ...EMPTY, updatedAt: null };
  const { id: _id, updatedAt, ...details } = row;
  return { ...details, updatedAt };
}

/** Speichert alle Felder; der Audit-Trigger hält alten und neuen Wert mit dem Akteur fest */
export async function saveProcedureDetails(actor: string, input: ProcedureDetails): Promise<void> {
  await withActor(actor, (tx) => putProcedureDetails(tx, input));
}

/** saveProcedureDetails in der Transaktion des Aufrufers */
export async function putProcedureDetails(tx: Tx, input: ProcedureDetails): Promise<void> {
  const values = procedureDetailsSchema.parse(input);
  await tx
    .insert(schema.procedureDetails)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: schema.procedureDetails.id, set: { ...values, updatedAt: sql`now()` } });
}
