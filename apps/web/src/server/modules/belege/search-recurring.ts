import { asc, or } from "drizzle-orm";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface RecurringDocumentHit {
  id: string;
  name: string;
  supplierName: string;
  intervalMonths: number;
  nextDate: string;
  status: (typeof schema.recurringDocuments.$inferSelect)["status"];
  lastError: string | null;
}

/** Dauerbelege für die Befehlspalette (#617): Name und Lieferant */
export async function searchRecurringDocuments(query: string, limit = 5): Promise<{ hits: RecurringDocumentHit[]; more: boolean }> {
  const rd = schema.recurringDocuments;
  const pattern = likePattern(query);
  const rows = await db
    .select({
      id: rd.id,
      name: rd.name,
      supplierName: rd.supplierName,
      intervalMonths: rd.intervalMonths,
      nextDate: rd.nextDate,
      status: rd.status,
      lastError: rd.lastError,
    })
    .from(rd)
    .where(or(unaccentIlike(rd.name, pattern), unaccentIlike(rd.supplierName, pattern)))
    .orderBy(asc(rd.name))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
