import { type SQLWrapper, sql } from "drizzle-orm";

/** Maskiert SQL-LIKE-Platzhalter, damit Nutzereingaben mit % oder _ buchstäblich gesucht werden */
export function likePattern(query: string, prefix = false): string {
  const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
  return `${prefix ? "" : "%"}${escaped}%`;
}

export function numberRank(column: SQLWrapper, query: string) {
  return sql`case when lower(${column}) = lower(${query}) then 0 when ${column} ilike ${likePattern(query, true)} then 1 else 2 end`;
}
