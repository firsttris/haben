import { sql, inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTaxReader } from "./invoice-tax.ts";

/**
 * Derselbe realisierte Anspruch trotz neuer Schlussbelegnummer; bestehende Zahlungszeilen bleiben am Original.
 * Nur versiegelt verbundene neue Schlussbelege zusammennehmen, keine Betrags-/Textsuche oder Anzahlungszahlungen.
 * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
export async function invoicePaymentGroups(ids: string[], q: Db | Tx = db): Promise<Map<string, string[]>> {
  const result = new Map(ids.map((id) => [id, [id]]));
  if (!ids.length) return result;
  const rows = await q.execute<{ target_id: string; id: string }>(sql`with recursive parents(target_id,id,replaces_invoice_id) as (
    select id,id,replaces_invoice_id from invoices where id in ${[...result.keys()]}
      and status='final' and kind='rechnung' and variant='schluss' and advance_accounting='deferred'
    union select p.target_id,i.id,i.replaces_invoice_id from parents p join invoices i on i.id=p.replaces_invoice_id
  ), groups(target_id,id) as (
    select target_id,id from parents where replaces_invoice_id is null
    union select g.target_id,i.id from groups g join invoices i on i.replaces_invoice_id=g.id
      where i.status='final' and i.kind='rechnung' and i.advance_accounting='deferred'
  ) select target_id,id from groups order by target_id,id`);
  const grouped = new Map<string, string[]>();
  for (const { target_id, id } of rows) grouped.set(target_id, [...(grouped.get(target_id) ?? []), id]);
  for (const [id, group] of grouped) result.set(id, group);
  return result;
}

export async function invoicePaymentGroup(id: string, q: Db | Tx = db): Promise<string[]> {
  return (await invoicePaymentGroups([id], q)).get(id)!;
}

/** Ein bloßes Schluss-Papierstorno begründet keine Erstattung bereits verdienten Entgelts. */
export async function paperCancellationIds(ids: string[], q: Db | Tx = db): Promise<Set<string>> {
  const result = new Set<string>();
  if (!ids.length) return result;
  const invoices = await q.select().from(schema.invoices).where(inArray(schema.invoices.id, ids));
  const taxes = invoiceTaxReader(q);
  for (const invoice of invoices) {
    if (invoice.kind !== "storno" || invoice.advanceAccounting !== "deferred") continue;
    if ((await taxes.original(invoice)).variant === "schluss") result.add(invoice.id);
  }
  return result;
}
