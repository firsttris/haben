import { sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db/index.ts";
import { invoicePaymentGroups } from "../rechnungen/index.ts";

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
