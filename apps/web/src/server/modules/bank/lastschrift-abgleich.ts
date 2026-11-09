import { randomUUID } from "node:crypto";
import { findDirectDebitBatch, findDirectDebitReturn, type CollectedDirectDebit, type DirectDebitState } from "@haben/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { openBooks } from "../buchhaltung/index.ts";
import { allocateSplit, BankError, bookPart, invoicePayments, lockTransaction } from "./bank.ts";

/**
 * Lastschriften im Bankabgleich (#445): die Sammelgutschrift einer Lastschriftdatei auf ihre Rechnungen aufteilen und
 * eine Rücklastschrift ihrer Lastschrift zuordnen (Erkennung in @haben/core, lastschrift-abgleich.ts). Gebucht wird wie
 * bei jeder Zahlung auf eine Rechnung; das Entgelt der Rückgabe als Kontoführung und Bankgebühren.
 */

export type DirectDebitMatch =
  | { kind: "sammler"; collectionDate: string; parts: { invoiceId: string; number: string; amount: number }[] }
  | {
      kind: "ruecklastschrift";
      itemId: string;
      invoiceId: string;
      number: string;
      amount: number;
      fee: number;
      mandateReference: string;
      reason: { code: string; text: string | null } | null;
    };

/** Netto zurückgegebener Betrag je Lastschrift (Rücklastschriften abzüglich aufgehobener) */
async function returnedAmounts(itemIds: string[], q: Db | Tx): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await q
    .select({ itemId: schema.allocations.directDebitItemId, sum: sql<string>`sum(${schema.allocations.amount})` })
    .from(schema.allocations)
    .where(and(isNotNull(schema.allocations.directDebitItemId), inArray(schema.allocations.directDebitItemId, itemIds)))
    .groupBy(schema.allocations.directDebitItemId);
  return new Map(rows.map((r) => [r.itemId!, -Number(r.sum)]));
}

/**
 * Lastschriften aus Haben mit ihrem Stand: zurück, wenn eine Rücklastschrift sie zurückgibt; gutgeschrieben, wenn die
 * Rechnung ganz erledigt ist (eingezogen wird nur der offene Teil, eine Teilzahlung davor zählt nicht als Gutschrift);
 * sonst eingereicht. Die jüngste Lastschrift einer Rechnung zählt, ältere sind zurückgegeben.
 */
export async function collectedDirectDebits(q: Db | Tx = db): Promise<CollectedDirectDebit[]> {
  const rows = await q
    .select({
      id: schema.sepaDirectDebitItems.id,
      invoiceId: schema.sepaDirectDebitItems.invoiceId,
      invoiceNumber: schema.invoices.number,
      gross: schema.invoices.gross,
      paymentInfoId: schema.sepaDirectDebitItems.paymentInfoId,
      endToEndId: schema.sepaDirectDebitItems.endToEndId,
      mandateReference: schema.sepaMandates.reference,
      collectionDate: schema.sepaDirectDebitItems.collectionDate,
      amount: schema.sepaDirectDebitItems.amount,
      debtorIban: schema.sepaDirectDebitItems.debtorIban,
    })
    .from(schema.sepaDirectDebitItems)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.sepaDirectDebitItems.invoiceId))
    .innerJoin(schema.sepaMandates, eq(schema.sepaMandates.id, schema.sepaDirectDebitItems.mandateId));
  const [returned, paid] = await Promise.all([
    returnedAmounts(
      rows.map((r) => r.id),
      q,
    ),
    invoicePayments(
      rows.map((r) => r.invoiceId),
      q,
    ),
  ]);
  return rows.map(({ gross, ...r }) => {
    const state: DirectDebitState =
      (returned.get(r.id) ?? 0) >= r.amount ? "zurueck" : (paid.get(r.invoiceId) ?? 0) >= gross ? "gutgeschrieben" : "eingereicht";
    return { ...r, invoiceNumber: r.invoiceNumber ?? "", state };
  });
}

/** Rechnungen mit einer Lastschrift, die nicht zurückgegeben ist; sie werden nicht noch einmal eingezogen */
export async function invoicesWithPendingDirectDebit(q: Db | Tx = db): Promise<Set<string>> {
  return new Set((await collectedDirectDebits(q)).filter((i) => i.state !== "zurueck").map((i) => i.invoiceId));
}

/** EndToEndIds der Lastschriften je Rechnung: Ein Einzelumsatz aus einem CAMT-Auszug findet so seine Rechnung */
export async function directDebitReferences(invoiceIds: string[], q: Db | Tx = db): Promise<Map<string, string[]>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await q
    .select({ invoiceId: schema.sepaDirectDebitItems.invoiceId, endToEndId: schema.sepaDirectDebitItems.endToEndId })
    .from(schema.sepaDirectDebitItems)
    .where(inArray(schema.sepaDirectDebitItems.invoiceId, invoiceIds));
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.invoiceId, [...(map.get(r.invoiceId) ?? []), r.endToEndId]);
  return map;
}

type Transaction = { id: string; amount: number; open: number; bookingDate: string; purpose: string; bankReference: string | null; endToEndId: string | null };

/** Sammler oder Rücklastschrift zu einem noch ganz offenen Umsatz; null ohne Treffer */
export async function directDebitMatch(tx: Transaction, q: Db | Tx = db): Promise<DirectDebitMatch | null> {
  if (tx.open === 0 || tx.open !== tx.amount) return null;
  const items = await collectedDirectDebits(q);
  if (items.length === 0) return null;
  const input = { amount: tx.amount, bookingDate: tx.bookingDate, purpose: tx.purpose, bankReference: tx.bankReference, endToEndId: tx.endToEndId };
  const batch = findDirectDebitBatch(input, items);
  if (batch) {
    return {
      kind: "sammler",
      collectionDate: batch[0]!.collectionDate,
      parts: batch.map((i) => ({ invoiceId: i.invoiceId, number: i.invoiceNumber, amount: i.amount })),
    };
  }
  const found = findDirectDebitReturn(input, items);
  if (!found) return null;
  return {
    kind: "ruecklastschrift",
    itemId: found.item.id,
    invoiceId: found.item.invoiceId,
    number: found.item.invoiceNumber,
    amount: found.item.amount,
    fee: found.fee,
    mandateReference: found.item.mandateReference,
    reason: found.reason,
  };
}

async function transactionFor(transactionId: string) {
  const [row] = await db
    .select({
      id: schema.bankTransactions.id,
      amount: schema.bankTransactions.amount,
      bookingDate: schema.bankTransactions.bookingDate,
      purpose: schema.bankTransactions.purpose,
      bankReference: schema.bankTransactions.bankReference,
      endToEndId: schema.bankTransactions.endToEndId,
      // Wie im Bankabgleich: ein verrechneter Umsatz (#457) ist nicht offen
      open: bankOpenAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.id, transactionId));
  if (!row) throw new BankError("Umsatz nicht gefunden.");
  return row;
}

/** Teilt die Sammelgutschrift auf die Rechnungen des Sammlers auf (Aufteilung, nur gemeinsam aufzuheben) */
export async function allocateDirectDebitBatch(actor: string, transactionId: string): Promise<void> {
  const match = await directDebitMatch(await transactionFor(transactionId));
  if (match?.kind !== "sammler") throw new BankError("Zu diesem Umsatz passt kein Sammler einer Lastschriftdatei.");
  await allocateSplit(actor, {
    transactionId,
    parts: match.parts.map((p) => ({ kind: "invoice" as const, invoiceId: p.invoiceId, amount: p.amount })),
  });
}

/**
 * Ordnet eine Rücklastschrift ihrer Lastschrift zu: die Rechnung wieder offen, das Entgelt der Bank als Kontoführung und
 * Bankgebühren (SKR03 4970, SKR04 6855). Beide Teile bilden eine Aufteilung und werden nur zusammen aufgehoben.
 */
export async function allocateDirectDebitReturn(actor: string, transactionId: string): Promise<void> {
  const match = await directDebitMatch(await transactionFor(transactionId));
  if (match?.kind !== "ruecklastschrift") throw new BankError("Zu diesem Umsatz passt keine zurückgegebene Lastschrift.");
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, transactionId);
    if (bank.open !== -(match.amount + match.fee)) throw new BankError("Der Umsatz ist schon zugeordnet.");
    const splitId = match.fee > 0 ? randomUUID() : null;
    const part = { kind: "ruecklastschrift" as const, invoiceId: match.invoiceId, directDebitItemId: match.itemId, amount: -match.amount };
    await bookPart(tx, company, bank, part, splitId);
    if (match.fee > 0) await bookPart(tx, company, bank, { kind: "gebuehren", amount: -match.fee }, splitId);
  });
}
