import { and, asc, eq, ne } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Leistungseinträge (#417) gehören dem Kunden, für den sie erfasst sind; „Abrechnen“ verknüpft sie mit einem Entwurf an
 * ihn (service_entries.invoice_id). Ginge der Entwurf an einen anderen Kunden, wären sie nach dem Festschreiben dort
 * abgerechnet und durch haben_reject_billed_service_entry gesperrt. Einen Kundenwechsel lehnt updateDraft deshalb ab;
 * finalizeIssues meldet Entwürfe, die schon vorher umgestellt wurden.
 */

/** Namen der Kunden, deren Einträge am Entwurf hängen, außer dem angegebenen; leer, wenn alle ihm gehören */
async function foreignEntryCustomers(q: Db | Tx, invoiceId: string, contactId: string | null): Promise<string> {
  const rows = await q
    .selectDistinct({ name: schema.contacts.name })
    .from(schema.serviceEntries)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.serviceEntries.contactId))
    .where(and(eq(schema.serviceEntries.invoiceId, invoiceId), contactId ? ne(schema.serviceEntries.contactId, contactId) : undefined))
    .orderBy(asc(schema.contacts.name));
  return rows.map((row) => row.name).join(", ");
}

/** Neuer Kunde am Entwurf (auch keiner): geht nur, wenn ihm alle verknüpften Einträge gehören */
export async function customerChangeProblem(tx: Tx, invoiceId: string, contactId: string | null): Promise<string | null> {
  const names = await foreignEntryCustomers(tx, invoiceId, contactId);
  return names ? `Der Entwurf enthält Leistungen von ${names}; zum Kundenwechsel den Entwurf löschen und neu abrechnen.` : null;
}

/** Vor dem Festschreiben: Einträge eines anderen Kunden als dem der Rechnung */
export async function serviceEntryCustomerIssues(q: Db | Tx, invoiceId: string, contactId: string | null): Promise<string[]> {
  const names = await foreignEntryCustomers(q, invoiceId, contactId);
  return names ? [`Der Entwurf enthält Leistungen von ${names}; diesen Kunden wählen oder den Entwurf löschen und neu abrechnen`] : [];
}
