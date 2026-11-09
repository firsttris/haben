import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { bankNeutralizedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/*
 * Gegenläufige Umsätze verrechnen (#457): Zwei Umsätze desselben Kontos, die sich aufheben (+1,00 € und −1,00 € einer
 * Kartenprüfung), gelten als erledigt. Es entsteht keine Buchung und keine Zuordnung; Voranmeldung und EÜR lesen nur
 * Zuordnungen und Buchungen und bleiben deshalb unberührt. Aufgehoben wird mit einer Gegenzeile.
 */

export class NeutralizationError extends UserError {}

export const neutralizeSchema = z.object({
  transactionId: z.uuid(),
  counterTransactionId: z.uuid(),
  note: z.string().trim().min(1, "Notiz fehlt: Warum heben sich die Umsätze auf?").max(500),
});

export type NeutralizeInput = z.input<typeof neutralizeSchema>;

/** Beide Umsätze sperren, wie beim Zuordnen, in fester Reihenfolge gegen gegenseitiges Blockieren */
async function lockPair(tx: Tx, ids: [string, string]) {
  const rows = await tx
    .select({
      id: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      amount: schema.bankTransactions.amount,
      currency: schema.bankTransactions.currency,
      open: bankOpenAmountSql.mapWith(Number),
      neutralized: bankNeutralizedSql.mapWith(Boolean),
    })
    .from(schema.bankTransactions)
    .where(inArray(schema.bankTransactions.id, ids))
    .orderBy(asc(schema.bankTransactions.id))
    .for("update");
  return ids.map((id) => rows.find((r) => r.id === id));
}

/** Verrechnet zwei gegenläufige, noch ganz offene Umsätze desselben Kontos miteinander */
export async function neutralizeTransactions(actor: string, input: NeutralizeInput): Promise<void> {
  const data = neutralizeSchema.parse(input);
  if (data.transactionId === data.counterTransactionId) throw new NeutralizationError("Verrechnen braucht zwei verschiedene Umsätze.");
  await withActor(actor, async (tx) => {
    const [a, b] = await lockPair(tx, [data.transactionId, data.counterTransactionId]);
    if (!a || !b) throw new NeutralizationError("Umsatz nicht gefunden.");
    if (a.bankAccountId !== b.bankAccountId) throw new NeutralizationError("Verrechnen geht nur zwischen Umsätzen auf demselben Konto.");
    if (a.amount + b.amount !== 0 || a.currency !== b.currency) {
      throw new NeutralizationError("Die Umsätze heben sich nicht auf: Sie müssen zusammen genau 0,00 € ergeben.");
    }
    if (a.neutralized || b.neutralized) throw new NeutralizationError("Einer der Umsätze ist schon verrechnet.");
    if (a.open !== a.amount || b.open !== b.amount) {
      throw new NeutralizationError("Einer der Umsätze ist ganz oder teilweise zugeordnet. Erst die Zuordnung aufheben.");
    }
    await tx.insert(schema.bankNeutralizations).values({
      transactionId: data.transactionId,
      counterTransactionId: data.counterTransactionId,
      note: data.note,
      createdBy: actor,
    });
  });
}

/** Hebt eine Verrechnung per Gegenzeile auf; beide Umsätze sind danach wieder offen */
export async function reverseNeutralization(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [row] = await tx.select().from(schema.bankNeutralizations).where(eq(schema.bankNeutralizations.id, id)).for("update");
    if (!row || row.reversesId) throw new NeutralizationError("Verrechnung nicht gefunden.");
    const [already] = await tx
      .select({ id: schema.bankNeutralizations.id })
      .from(schema.bankNeutralizations)
      .where(eq(schema.bankNeutralizations.reversesId, id));
    if (already) throw new NeutralizationError("Die Verrechnung ist bereits aufgehoben.");
    await tx.insert(schema.bankNeutralizations).values({
      transactionId: row.transactionId,
      counterTransactionId: row.counterTransactionId,
      reversesId: row.id,
      createdBy: actor,
    });
  });
}

/** Gegenläufige Umsätze, mit denen sich ein Umsatz verrechnen ließe: dasselbe Konto, umgekehrter Betrag, ganz offen */
async function candidates(transaction: { id: string; bankAccountId: string; amount: number; bookingDate: string }) {
  return (
    db
      .select({
        id: schema.bankTransactions.id,
        bookingDate: schema.bankTransactions.bookingDate,
        amount: schema.bankTransactions.amount,
        counterpartyName: schema.bankTransactions.counterpartyName,
        purpose: schema.bankTransactions.purpose,
      })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.bankAccountId, transaction.bankAccountId),
          eq(schema.bankTransactions.amount, -transaction.amount),
          ne(schema.bankTransactions.id, transaction.id),
          sql`${bankOpenAmountSql} = ${schema.bankTransactions.amount}`,
        ),
      )
      // Die zeitlich nächsten zuerst: Kartenprüfung und Rückbuchung liegen meist wenige Tage auseinander
      .orderBy(sql`abs(${schema.bankTransactions.bookingDate} - ${transaction.bookingDate}::date)`, asc(schema.bankTransactions.bookingDate))
      .limit(10)
  );
}

export type NeutralizationView = Awaited<ReturnType<typeof neutralizationView>>;

/**
 * Verrechnungen eines Umsatzes für den Bankabgleich: die gültige (höchstens eine), die aufgehobenen und, solange der
 * Umsatz ganz offen ist, die gegenläufigen Umsätze, mit denen er sich verrechnen ließe.
 */
export async function neutralizationView(transactionId: string) {
  const [transaction] = await db
    .select({
      id: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      amount: schema.bankTransactions.amount,
      bookingDate: schema.bankTransactions.bookingDate,
      open: bankOpenAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.id, transactionId));
  if (!transaction) return { active: null, reversed: [], candidates: [] };
  const n = schema.bankNeutralizations;
  const rows = await db
    .select()
    .from(n)
    .where(or(eq(n.transactionId, transactionId), eq(n.counterTransactionId, transactionId)))
    .orderBy(asc(n.createdAt), asc(n.id));
  const reversedIds = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  const originals = rows.filter((r) => !r.reversesId);
  const counterpartIds = originals.map((r) => (r.transactionId === transactionId ? r.counterTransactionId : r.transactionId));
  const counterparts =
    counterpartIds.length === 0
      ? []
      : await db
          .select({
            id: schema.bankTransactions.id,
            bookingDate: schema.bankTransactions.bookingDate,
            amount: schema.bankTransactions.amount,
            counterpartyName: schema.bankTransactions.counterpartyName,
            purpose: schema.bankTransactions.purpose,
          })
          .from(schema.bankTransactions)
          .where(inArray(schema.bankTransactions.id, counterpartIds));
  const entries = originals.map((r, i) => ({
    id: r.id,
    note: r.note,
    createdAt: r.createdAt,
    reversed: reversedIds.has(r.id),
    counterpart: counterparts.find((c) => c.id === counterpartIds[i])!,
  }));
  return {
    active: entries.find((e) => !e.reversed) ?? null,
    reversed: entries.filter((e) => e.reversed),
    candidates: transaction.open === transaction.amount ? await candidates(transaction) : [],
  };
}
