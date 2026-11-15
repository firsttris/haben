import type { CentRange } from "@haben/core";
import { type SQLWrapper, between, or, sql } from "drizzle-orm";

/** Maskiert SQL-LIKE-Platzhalter, damit Nutzereingaben mit % oder _ buchstäblich gesucht werden */
export function likePattern(query: string, prefix = false): string {
  const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
  return `${prefix ? "" : "%"}${escaped}%`;
}

export function unaccentIlike(column: SQLWrapper, pattern: string) {
  return sql`haben_unaccent(${column}) ilike haben_unaccent(${pattern})`;
}

export function numberRank(column: SQLWrapper, query: string) {
  return sql`case when lower(${column}) = lower(${query}) then 0 when ${column} ilike ${likePattern(query, true)} then 1 else 2 end`;
}

/**
 * Betrag im Bereich aus `parseEuroSearchRange` (ganzer Euro oder genau); `between` nutzt einen btree-Index auf der Spalte.
 * Nur auf Brutto- bzw. gezahlte Beträge anwenden, nicht auf netto oder offene Reste (entschieden in #1038, search-money.ts).
 */
export function amountIn(column: SQLWrapper, range: CentRange) {
  return between(column, range.min, range.max);
}

/** Wie `amountIn`, dazu der Gegenwert mit umgekehrtem Vorzeichen (Bankumsatz, Kasse, Pauschalen, Archiv) */
export function amountInEitherSign(column: SQLWrapper, range: CentRange) {
  return or(between(column, range.min, range.max), between(column, -range.max, -range.min));
}
