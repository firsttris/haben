import { parseDateSearch } from "@haben/core";
import { desc, eq, or } from "drizzle-orm";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface ServiceEntryHit {
  id: string;
  workedOn: string;
  minutes: number;
  description: string;
  project: string;
  customer: string;
}

/** Leistungen für die Befehlspalette (#617): Text, Projekt, Kunde und Datum */
export async function searchServiceEntries(query: string, limit = 5): Promise<{ hits: ServiceEntryHit[]; more: boolean }> {
  const se = schema.serviceEntries;
  const pattern = likePattern(query);
  const queryDate = parseDateSearch(query);
  const rows = await db
    .select({
      id: se.id,
      workedOn: se.workedOn,
      minutes: se.minutes,
      description: se.description,
      project: se.project,
      customer: schema.contacts.name,
    })
    .from(se)
    .innerJoin(schema.contacts, eq(schema.contacts.id, se.contactId))
    .where(
      or(
        unaccentIlike(se.description, pattern),
        unaccentIlike(se.project, pattern),
        unaccentIlike(schema.contacts.name, pattern),
        ...(queryDate !== null ? [eq(se.workedOn, queryDate)] : []),
      ),
    )
    .orderBy(desc(se.workedOn), desc(se.createdAt))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
