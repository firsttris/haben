import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoicePaymentGroups } from "./advance-payment-group.ts";

/*
 * Zahlungsstand von Rechnungen und Belegen aus den Nebenbüchern der Bank (Zuordnungen, Ausbuchungen, Kassenbuch,
 * Verrechnungen), nur lesend. Geschrieben werden sie in bank; gelesen wird hier, weil rechnungen unter bank steht und
 * Liste und Festschreiben den Stand brauchen.
 */

/**
 * Erledigter Betrag je Rechnung bzw. Beleg: Zuordnungen und Ausbuchungen (Skonto, Forderungsausfall), Vorzeichen
 * wie auf dem Konto. Ausbuchungen bewegen kein Geld, zählen für „offen“ aber wie eine Zahlung. Bei Rechnungen auch die
 * Bareinnahmen im Kassenbuch (samt Gegenzeilen) und die Verrechnung mit einer Kundenkorrektur (#877); bar bezahlte Belege
 * sind schon beim Buchen bezahlt und zählen hier nicht.
 */
export async function paidByTarget(column: "invoice_id" | "document_id", ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const col = sql.raw(column);
  const cash = column === "invoice_id" ? sql`union all select invoice_id as id, amount from cash_entries where invoice_id in ${ids}` : sql``;
  // Verrechnungen: zwischen Belegen (#274) und zwischen Ausgangsrechnung und Kundenkorrektur (#877)
  const verrechnet =
    column === "document_id"
      ? sql`union all select document_id as id, amount from document_settlements where document_id in ${ids}`
      : sql`union all select invoice_id as id, amount from invoice_settlements where invoice_id in ${ids}`;
  const rows = await q.execute<{ id: string; paid: string }>(
    sql`select id, sum(amount) as paid from (
          select ${col} as id, amount from allocations where ${col} in ${ids}
          union all select ${col} as id, amount from write_offs where ${col} in ${ids}
          ${verrechnet}
          ${cash}
        ) settled group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.paid)]));
}

export async function invoicePayments(ids: string[], q: Db | Tx = db) {
  const groups = await invoicePaymentGroups(ids, q);
  const paid = await paidByTarget("invoice_id", [...new Set([...groups.values()].flat())], q);
  return new Map(
    [...groups]
      .filter(([, group]) => group.some((id) => paid.has(id)))
      .map(([id, group]) => [id, group.reduce((sum, target) => sum + (paid.get(target) ?? 0), 0)]),
  );
}

/** Ausgebuchte Beträge je Rechnung (Skonto und Forderungsausfall, Gegenzeilen abgezogen) */
export async function invoiceWrittenOff(ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({ id: schema.writeOffs.invoiceId, sum: sql<string>`sum(${schema.writeOffs.amount})` })
    .from(schema.writeOffs)
    .where(inArray(schema.writeOffs.invoiceId, ids))
    .groupBy(schema.writeOffs.invoiceId);
  return new Map(rows.filter((r) => Number(r.sum) !== 0).map((r) => [r.id!, Number(r.sum)]));
}

/** Als Forderungsausfall ausgebuchte Beträge je Rechnung (Gegenzeilen abgezogen) */
export async function invoiceLosses(ids: string[], q: Db | Tx = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({ id: schema.writeOffs.invoiceId, sum: sql<string>`sum(${schema.writeOffs.amount})` })
    .from(schema.writeOffs)
    .where(and(inArray(schema.writeOffs.invoiceId, ids), eq(schema.writeOffs.kind, "forderungsausfall")))
    .groupBy(schema.writeOffs.invoiceId);
  return new Map(rows.map((r) => [r.id!, Number(r.sum)]));
}

/**
 * Datum der letzten Zahlung oder Ausbuchung je Rechnung (Bank, Kasse, Skonto, Forderungsausfall), für „Bezahlt am …“;
 * wie invoicePayments über die Zahlungsgruppe, damit der Ersatz-Schluss die Zahlungen am alten Schluss mitzählt (#750)
 */
export async function invoiceLastSettledOn(ids: string[], q: Db | Tx = db): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const groups = await invoicePaymentGroups(ids, q);
  const targets = [...new Set([...groups.values()].flat())];
  const rows = await q.execute<{ id: string; settled_on: string }>(
    sql`select id, max(d)::text as settled_on from (
          select a.invoice_id as id, t.booking_date as d from allocations a join bank_transactions t on t.id = a.transaction_id
            where a.invoice_id in ${targets}
          union all select invoice_id as id, date as d from write_offs where invoice_id in ${targets}
          union all select invoice_id as id, date as d from cash_entries where invoice_id in ${targets}
        ) settled group by 1`,
  );
  const byTarget = new Map([...rows].map((r) => [r.id, r.settled_on]));
  const result = new Map<string, string>();
  for (const [id, group] of groups) {
    // JJJJ-MM-TT: das späteste Datum ist das letzte nach dem Sortieren
    const last = group
      .flatMap((target) => byTarget.get(target) ?? [])
      .sort()
      .at(-1);
    if (last) result.set(id, last);
  }
  return result;
}
