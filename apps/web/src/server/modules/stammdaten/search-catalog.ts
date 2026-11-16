import { and, asc, isNull, or } from "drizzle-orm";
import { likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
import { contactsPart } from "./contacts.ts";

export interface ArticleHit {
  id: string;
  number: string;
  description: string;
  unit: string;
  unitPrice: number;
}

/** Artikel für die Befehlspalette (#617): Nummer und Bezeichnung */
function articlesPart(query: string, limit: number) {
  const a = schema.articles;
  const pattern = likePattern(query);
  return searchPart(
    { id: a.id, number: a.number, description: a.description, unit: a.unit, unitPrice: a.unitPrice },
    (fields) =>
      db
        .select(fields)
        .from(a)
        .where(and(isNull(a.archivedAt), or(unaccentIlike(a.number, pattern), unaccentIlike(a.description, pattern))))
        .orderBy(numberRank(a.number, query), asc(a.description))
        .limit(limit + 1),
    (rows): { hits: ArticleHit[]; more: boolean } => firstHits(rows, limit),
  );
}

export interface TextBlockHit {
  id: string;
  name: string;
  kind: "kopf" | "fuss";
}

/** Textbausteine für die Befehlspalette (#617): Name und Text */
function textBlocksPart(query: string, limit: number) {
  const tb = schema.textBlocks;
  const pattern = likePattern(query);
  return searchPart(
    { id: tb.id, name: tb.name, kind: tb.kind },
    (fields) =>
      db
        .select(fields)
        .from(tb)
        .where(and(isNull(tb.archivedAt), or(unaccentIlike(tb.name, pattern), unaccentIlike(tb.text, pattern))))
        .orderBy(asc(tb.name))
        .limit(limit + 1),
    (rows): { hits: TextBlockHit[]; more: boolean } => firstHits(rows, limit),
  );
}

/** Kontakte, Artikel und Textbausteine für die Befehlspalette in einer Abfrage, nur die gefragten Gruppen */
export function searchStammdaten(query: string, groups: readonly string[], limit = 5) {
  return runSearchParts(
    partsFor(groups, {
      contacts: () => contactsPart(query, limit),
      articles: () => articlesPart(query, limit),
      textBlocks: () => textBlocksPart(query, limit),
    }),
  );
}
