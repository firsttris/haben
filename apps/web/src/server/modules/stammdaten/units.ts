import { UNITS, unitLabelIssues } from "@haben/core";
import { EINHEITENCODES } from "@haben/einvoice";
import { asc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/** Eigene Mengeneinheiten (#748): Bezeichnung und Code nach UN/ECE Rec. 20/21, nur archivieren statt löschen */

export class UnitError extends UserError {}

export type Unit = typeof schema.units.$inferSelect;

export function listUnits(q: Db | Tx = db): Promise<Unit[]> {
  return q.select().from(schema.units).orderBy(asc(schema.units.label));
}

/** Bezeichnung → Code für jede eigene Einheit, auch archivierte, für die Positionen der E-Rechnung */
export async function loadUnitCodes(q: Db | Tx = db): Promise<Record<string, string>> {
  return Object.fromEntries((await listUnits(q)).map((unit) => [unit.label, unit.code]));
}

export async function createUnit(actor: string, input: { label: string; code: string }): Promise<Unit> {
  const label = input.label.trim();
  const code = input.code.trim().toUpperCase();
  return withActor(actor, async (tx) => {
    const issues = unitLabelIssues(
      label,
      (await listUnits(tx)).map((unit) => unit.label),
    );
    if (issues.length > 0) throw new UnitError(issues.join(" · "));
    if (!EINHEITENCODES.has(code)) throw new UnitError(`Der Code „${code}“ steht nicht in UN/ECE Recommendation 20/21; ohne passenden Code geht C62 (Stück).`);
    const [created] = await tx.insert(schema.units).values({ label, code }).returning();
    return created!;
  });
}

export async function setUnitArchived(actor: string, id: string, archived: boolean): Promise<void> {
  await withActor(actor, (tx) =>
    tx
      .update(schema.units)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.units.id, id)),
  );
}

/** Für Artikel: feste oder angelegte eigene Einheit; archivierte zählen, damit ein älterer Artikel speicherbar bleibt */
export async function assertKnownUnit(label: string, q: Db | Tx = db): Promise<void> {
  if (Object.hasOwn(UNITS, label)) return;
  if ((await listUnits(q)).some((unit) => unit.label === label)) return;
  throw new UnitError(`Einheit „${label}“ gibt es nicht; unter Einstellungen › Rechnungen › Einheiten anlegen.`);
}
