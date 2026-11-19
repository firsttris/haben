import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { withActor } from "../../db/actor.ts";
import { bankNeutralizedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { BankError } from "./bank-error.ts";

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

/**
 * Warum sich der Umsatz nicht kennzeichnen lässt; null, wenn es geht. Sperrt den Umsatz wie die Zahlungswege (lockTransaction).
 * Aufgehobene Zuordnungen, Verrechnungen und Ausbuchungen zählen nicht: Der Umsatz ist dann wieder ganz offen.
 */
async function hindernis(tx: Tx, transactionId: string): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select a.purpose,
      ${bankOpenAmountSql} = bank_transactions.amount as ganz_offen,
      ${bankNeutralizedSql} as verrechnet,
      exists (select 1 from write_offs w where w.transaction_id = bank_transactions.id and w.reverses_id is null
        and not exists (select 1 from write_offs r where r.reverses_id = w.id)) as ausgebucht
    from bank_transactions join bank_accounts a on a.id = bank_transactions.bank_account_id
    where bank_transactions.id = ${transactionId}
    for update of bank_transactions
  `)) as unknown as { purpose: string; ganz_offen: boolean; verrechnet: boolean; ausgebucht: boolean }[];
  if (!row) return "Umsatz nicht gefunden.";
  if (row.purpose !== "privat") return "Das geht nur auf einem privaten Konto; nur dort fehlt dem Umsatz die Buchungsart.";
  if (row.verrechnet || row.ausgebucht) return "Der Umsatz ist schon verrechnet oder ausgebucht.";
  if (!row.ganz_offen) return "Der Umsatz ist schon zugeordnet.";
  return null;
}

/** Kennzeichnet einen offenen Umsatz auf einem privaten Konto als „privat, kein Betriebsvorgang" */
export async function markierePrivat(actor: string, transactionId: string, note = ""): Promise<void> {
  const text = note.trim().slice(0, 500);
  await withActor(actor, async (tx) => {
    const grund = await hindernis(tx, transactionId);
    if (grund) throw new BankError(grund);
    await tx
      .insert(schema.bankPrivateMarks)
      .values({ transactionId, note: text })
      .onConflictDoUpdate({ target: schema.bankPrivateMarks.transactionId, set: { note: text } });
  });
}

/** Nimmt die Kennzeichnung zurück; der Umsatz steht wieder als offen in der Liste */
export async function hebePrivatAuf(actor: string, transactionId: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.bankPrivateMarks).where(eq(schema.bankPrivateMarks.transactionId, transactionId)));
}
