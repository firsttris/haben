import { UserError } from "../../errors.ts";
import { choiceProblem } from "@haben/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Auswahl des Kunden bei optionalen und alternativen Positionen eines Angebots (quote_choices): welche optionalen
 * Positionen er nimmt und welche Alternative statt ihrer Hauptposition. Rechnung, Abschläge und Auftragsbestätigung
 * übernehmen nur die gewählten. Fest, sobald eine Rechnung zum Angebot festgeschrieben ist (Trigger in drizzle/0151).
 */

export class QuoteChoiceError extends UserError {}

/** Gewählte Positionen (Positionsnummern), aufsteigend */
export async function quoteChoices(quoteId: string, q: Db | Tx = db): Promise<number[]> {
  const rows = await q
    .select({ position: schema.quoteChoices.position })
    .from(schema.quoteChoices)
    .where(eq(schema.quoteChoices.quoteId, quoteId))
    .orderBy(asc(schema.quoteChoices.position));
  return rows.map((r) => r.position);
}

/** Festgeschriebene, nicht stornierte Rechnung zum Angebot: ab dann bleibt die Auswahl, wie sie ist */
async function choicesLocked(tx: Tx, quoteId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.quoteId, quoteId),
        eq(schema.invoices.status, "final"),
        sql`not exists (select 1 from invoices s where s.corrects_id = ${schema.invoices.id} and s.kind = 'storno' and s.status = 'final')`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Auswahl ersetzen, wenn sie sich ändert; das Angebot ist vom Aufrufer gesperrt */
export async function storeQuoteChoices(tx: Tx, quoteId: string, chosen: number[]): Promise<void> {
  const wanted = [...new Set(chosen)].sort((a, b) => a - b);
  const current = await quoteChoices(quoteId, tx);
  if (wanted.length === current.length && wanted.every((p, i) => p === current[i])) return;
  const lines = await tx
    .select({ position: schema.quoteLines.position, kind: schema.quoteLines.kind })
    .from(schema.quoteLines)
    .where(eq(schema.quoteLines.quoteId, quoteId))
    .orderBy(asc(schema.quoteLines.position));
  const problem = choiceProblem(lines, wanted);
  if (problem) throw new QuoteChoiceError(`${problem}.`);
  if (await choicesLocked(tx, quoteId)) {
    throw new QuoteChoiceError("Zum Angebot ist schon eine Rechnung festgeschrieben; die Auswahl der Positionen lässt sich nicht mehr ändern.");
  }
  await tx.delete(schema.quoteChoices).where(eq(schema.quoteChoices.quoteId, quoteId));
  if (wanted.length > 0) await tx.insert(schema.quoteChoices).values(wanted.map((position) => ({ quoteId, position })));
}
