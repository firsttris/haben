import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/** Nur ursprüngliche, noch nicht per Gegenzeile aufgehobene Zuordnungen. */
function active<T extends { id: string; reversesId: string | null }>(rows: T[]): T[] {
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  return rows.filter((r) => !r.reversesId && !reversed.has(r.id));
}

/**
 * Was der Storno eines Belegs im Bankabgleich aufheben muss: alle aktiven Zahlungen samt ganzen Aufteilungen.
 * Die IDs bestätigen genau diesen Umfang, damit zwischen Rückfrage und Storno keine weiteren Vorgänge hinzukommen.
 */
export async function documentBankAllocations(documentId: string, q: Db | Tx = db) {
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const e = schema.journalEntries;
  const own = active(await q.select({ id: a.id, splitId: a.splitId, reversesId: a.reversesId }).from(a).where(eq(a.documentId, documentId)));
  if (own.length === 0) return [];
  const splits = [...new Set(own.flatMap((r) => (r.splitId ? [r.splitId] : [])))];
  const rows = await q
    .select({
      id: a.id,
      reversesId: a.reversesId,
      splitId: a.splitId,
      transactionId: a.transactionId,
      documentId: a.documentId,
      date: t.bookingDate,
      amount: a.amount,
      description: sql<string>`coalesce(${e.description}, 'Bankzuordnung')`,
    })
    .from(a)
    .innerJoin(t, eq(t.id, a.transactionId))
    .leftJoin(e, and(eq(e.sourceType, "allocation"), eq(e.sourceId, a.id), isNull(e.reversesId)))
    .where(splits.length > 0 ? or(eq(a.documentId, documentId), inArray(a.splitId, splits)) : eq(a.documentId, documentId))
    .orderBy(asc(a.id));
  return active(rows);
}
