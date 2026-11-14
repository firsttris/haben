import { asc, eq, or, sql } from "drizzle-orm";
import { likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface EmployeeHit {
  id: string;
  personalnummer: number;
  vorname: string;
  nachname: string;
  art: string;
}

/**
 * Mitarbeiter für die Befehlspalette (#617): ausschließlich Name und Personalnummer.
 * Steuer-ID, SV-Nummer, IBAN und Geburtsdatum werden bewusst nicht durchsucht.
 */
export async function searchEmployees(query: string, limit = 5): Promise<{ hits: EmployeeHit[]; more: boolean }> {
  const e = schema.employees;
  const pattern = likePattern(query);
  const num = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;

  const rows = await db
    .select({
      id: e.id,
      personalnummer: e.personalnummer,
      vorname: e.vorname,
      nachname: e.nachname,
      art: e.art,
    })
    .from(e)
    .where(
      or(
        unaccentIlike(e.vorname, pattern),
        unaccentIlike(e.nachname, pattern),
        unaccentIlike(sql`${e.vorname} || ' ' || ${e.nachname}`, pattern),
        ...(num !== null && Number.isSafeInteger(num) && num <= 2_147_483_647 ? [eq(e.personalnummer, num)] : []),
      ),
    )
    .orderBy(numberRank(sql`${e.personalnummer}::text`, query), asc(e.nachname), asc(e.vorname))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
