import { asc, or } from "drizzle-orm";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, searchPart } from "../../db/search-parts.ts";

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
export function recurringDocumentsPart(query: string, limit: number) {
  const rd = schema.recurringDocuments;
  const pattern = likePattern(query);
  return searchPart(
    {
      id: rd.id,
      name: rd.name,
      supplierName: rd.supplierName,
      intervalMonths: rd.intervalMonths,
      nextDate: rd.nextDate,
      status: rd.status,
      lastError: rd.lastError,
    },
    (fields) =>
      db
        .select(fields)
        .from(rd)
        .where(or(unaccentIlike(rd.name, pattern), unaccentIlike(rd.supplierName, pattern)))
        .orderBy(asc(rd.name))
        .limit(limit + 1),
    (rows): { hits: RecurringDocumentHit[]; more: boolean } => firstHits(rows, limit),
  );
}
