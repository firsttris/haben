import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { withActor } from "../../db/actor.ts";
import { BankError } from "./bank.ts";

/*
 * Umsätze auf einem privaten Konto, für die es dort keine Buchungsart gibt (#1088). Auf einem privaten Konto sind
 * „Privat", Bankgebühren, Zinserträge, Geldtransit und Spenden gesperrt (konto-angebot.ts, #873); eine private
 * Einkommensteuer-Erstattung lässt sich dort also nicht buchen, ohne sie zum Betriebsvorgang zu machen. Statt sie
 * jedes Mal als offenen Posten zu zeigen, kennzeichnet der Betreiber sie einmal: Sie bleibt ungebucht, zählt nicht
 * als offen und steht in der Liste als „privat, kein Betriebsvorgang".
 *
 * Die Markierung liegt in einer eigenen Tabelle neben dem Umsatz, weil `bank_transactions` anhängend ist. Gebucht
 * wird nichts; die EÜR bleibt unberührt.
 */

/** Warum sich der Umsatz nicht kennzeichnen lässt; null, wenn es geht */
async function hindernis(transactionId: string): Promise<string | null> {
  const [row] = (await db.execute(sql`
    select t.id, t.amount, a.purpose,
      coalesce((select sum(al.amount) from allocations al where al.transaction_id = t.id and al.reverses_id is null), 0) as zugeordnet,
      exists (select 1 from bank_neutralizations n where t.id in (n.transaction_id, n.counter_transaction_id)) as verrechnet,
      exists (select 1 from write_offs w where w.transaction_id = t.id) as ausgebucht
    from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
    where t.id = ${transactionId}
  `)) as unknown as { purpose: string; zugeordnet: number; verrechnet: boolean; ausgebucht: boolean }[];
  if (!row) return "Umsatz nicht gefunden.";
  if (row.purpose !== "privat") return "Das geht nur auf einem privaten Konto; nur dort fehlt dem Umsatz die Buchungsart.";
  if (row.verrechnet || row.ausgebucht) return "Der Umsatz ist schon verrechnet oder ausgebucht.";
  if (Number(row.zugeordnet) !== 0) return "Der Umsatz ist schon zugeordnet.";
  return null;
}

/** Kennzeichnet einen offenen Umsatz auf einem privaten Konto als „privat, kein Betriebsvorgang" */
export async function markierePrivat(actor: string, transactionId: string, note = ""): Promise<void> {
  const grund = await hindernis(transactionId);
  if (grund) throw new BankError(grund);
  const text = note.trim().slice(0, 500);
  await withActor(actor, (tx) =>
    tx
      .insert(schema.bankPrivateMarks)
      .values({ transactionId, note: text })
      .onConflictDoUpdate({ target: schema.bankPrivateMarks.transactionId, set: { note: text } }),
  );
}

/** Nimmt die Kennzeichnung zurück; der Umsatz steht wieder als offen in der Liste */
export async function hebePrivatAuf(actor: string, transactionId: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.bankPrivateMarks).where(eq(schema.bankPrivateMarks.transactionId, transactionId)));
}
