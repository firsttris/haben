import { asc, eq, or } from "drizzle-orm";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface RecurringInvoiceHit {
  id: string;
  name: string;
  customer: string;
  intervalMonths: number;
  nextDate: string;
  active: boolean;
  lastError: string | null;
}

/** Wiederkehrende Rechnungen für die Befehlspalette (#617): Name und Kunde */
export async function searchRecurringInvoices(query: string, limit = 5): Promise<{ hits: RecurringInvoiceHit[]; more: boolean }> {
  const ri = schema.recurringInvoices;
  const pattern = likePattern(query);
  const rows = await db
    .select({
      id: ri.id,
      name: ri.name,
      customer: schema.contacts.name,
      intervalMonths: ri.intervalMonths,
      nextDate: ri.nextDate,
      active: ri.active,
      lastError: ri.lastError,
    })
    .from(ri)
    .innerJoin(schema.contacts, eq(schema.contacts.id, ri.contactId))
    .where(or(unaccentIlike(ri.name, pattern), unaccentIlike(schema.contacts.name, pattern)))
    .orderBy(asc(ri.name))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
