import { and, asc, isNull, or } from "drizzle-orm";
import { likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface ArticleHit {
  id: string;
  number: string;
  description: string;
  unit: string;
  unitPrice: number;
}

/** Artikel für die Befehlspalette (#617): Nummer und Bezeichnung */
export async function searchArticles(query: string, limit = 5): Promise<{ hits: ArticleHit[]; more: boolean }> {
  const a = schema.articles;
  const pattern = likePattern(query);
  const rows = await db
    .select({ id: a.id, number: a.number, description: a.description, unit: a.unit, unitPrice: a.unitPrice })
    .from(a)
    .where(and(isNull(a.archivedAt), or(unaccentIlike(a.number, pattern), unaccentIlike(a.description, pattern))))
    .orderBy(numberRank(a.number, query), asc(a.description))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

export interface TextBlockHit {
  id: string;
  name: string;
  kind: "kopf" | "fuss";
}

/** Textbausteine für die Befehlspalette (#617): Name und Text */
export async function searchTextBlocks(query: string, limit = 5): Promise<{ hits: TextBlockHit[]; more: boolean }> {
  const tb = schema.textBlocks;
  const pattern = likePattern(query);
  const rows = await db
    .select({ id: tb.id, name: tb.name, kind: tb.kind })
    .from(tb)
    .where(and(isNull(tb.archivedAt), or(unaccentIlike(tb.name, pattern), unaccentIlike(tb.text, pattern))))
    .orderBy(asc(tb.name))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
