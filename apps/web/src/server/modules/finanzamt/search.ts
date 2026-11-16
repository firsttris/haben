import { desc, or } from "drizzle-orm";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface PostfachDocumentHit {
  id: string;
  dateibezeichnung: string;
  veranlagungszeitraum: string;
  bescheiddatum: string;
  datenart: string;
}

/** Bescheide im ELSTER-Postfach für die Befehlspalette (#617) */
export async function searchPostfachDocuments(query: string, limit = 5): Promise<{ hits: PostfachDocumentHit[]; more: boolean }> {
  const pd = schema.postfachDocuments;
  const pattern = likePattern(query);
  const rows = await db
    .select({
      id: pd.id,
      dateibezeichnung: pd.dateibezeichnung,
      veranlagungszeitraum: pd.veranlagungszeitraum,
      bescheiddatum: pd.bescheiddatum,
      datenart: pd.datenart,
    })
    .from(pd)
    .where(or(unaccentIlike(pd.dateibezeichnung, pattern), unaccentIlike(pd.veranlagungszeitraum, pattern), unaccentIlike(pd.datenart, pattern)))
    .orderBy(desc(pd.fetchedAt))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
