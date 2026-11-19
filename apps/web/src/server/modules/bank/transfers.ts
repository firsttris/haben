// Geldtransit zwischen eigenen Konten und Auszahlungen der Zahlungsdienstleister
import { insertAllocation } from "./settlement-store.ts";
import { BankError } from "./bank-error.ts";
import { providerPattern, directPosting, findTransferCounterpart, payoutKey, aufKontoAngeboten } from "@haben/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { onLedger, PRIVAT_NICHT_BUCHBAR } from "./allocation.ts";

/**
 * Ganz offene Gegenbuchung eines Geldtransits auf einem der anderen Konten (± 5 Tage, gleicher Betrag), deren Gegenkonto
 * das Ausgangskonto ist (sourceIban) bzw. deren Gegenpartei der Dienstleister ist (pattern)
 */
export async function transferCounterpart(
  tx: { id: string; bookingDate: string; amount: number },
  sourceIban: string | null,
  accountIds: string[],
  pattern: RegExp | null,
) {
  if (accountIds.length === 0) return null;
  const rows = await db
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(
      and(
        inArray(schema.bankTransactions.bankAccountId, accountIds),
        eq(schema.bankTransactions.amount, -tx.amount),
        sql`${schema.bankTransactions.bookingDate} between ${tx.bookingDate}::date - 5 and ${tx.bookingDate}::date + 5`,
      ),
    );
  const match = findTransferCounterpart(tx, sourceIban, rows, pattern);
  return match ? { id: match.id, bookingDate: match.bookingDate, amount: match.amount, counterpartyName: match.counterpartyName } : null;
}

export type TransferCounterpart = { id: string; bookingDate: string; amount: number; counterpartyName: string; payoutIds?: string[] };

/** Teile von Auszahlungen (Referenz „payout-…|“) in den Konten der Dienstleister, ± 10 Tage um den Eingang */
export async function payoutCandidates(accountIds: string[], bookingDate: string) {
  return db
    .select({
      id: schema.bankTransactions.id,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      bankReference: schema.bankTransactions.bankReference,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(
      and(
        inArray(schema.bankTransactions.bankAccountId, accountIds),
        sql`${schema.bankTransactions.bankReference} like 'payout-%|%'`,
        sql`${schema.bankTransactions.bookingDate} between ${bookingDate}::date - 10 and ${bookingDate}::date + 10`,
      ),
    );
}

export const transferSchema = z.object({
  transactionId: z.uuid(),
  counterpartId: z.uuid(),
  /** Weitere Teile derselben Auszahlung im Konto des Dienstleisters (Shopify Payments: ein Teil je Transaktion) */
  payoutIds: z.array(z.uuid()).max(1000).optional(),
});

/**
 * Geldtransit zwischen zwei eigenen Konten: beide Umsätze (gleicher Betrag, umgekehrtes Vorzeichen) in einem
 * Schritt über das Geldtransitkonto buchen. Auf dem Geldtransitkonto heben sich beide Seiten auf.
 */
export async function allocateTransfer(actor: string, input: z.infer<typeof transferSchema>): Promise<void> {
  await withActor(actor, (tx) => allocateTransferIn(tx, input));
}

/** Geldtransit in der Transaktion des Aufrufers (etwa nach dem Anlegen der Auszahlung eines App-Stores) */
export async function allocateTransferIn(tx: Tx, input: z.infer<typeof transferSchema>): Promise<void> {
  {
    const company = await openBooks(tx);
    // Feste Reihenfolge beim Sperren, damit zwei gleichzeitige Aufrufe sich nicht gegenseitig blockieren
    const ids = [...new Set([input.transactionId, input.counterpartId, ...(input.payoutIds ?? [])])].sort();
    const rows = await tx
      .select({
        id: schema.bankTransactions.id,
        bankAccountId: schema.bankTransactions.bankAccountId,
        amount: schema.bankTransactions.amount,
        bookingDate: schema.bankTransactions.bookingDate,
        counterpartyName: schema.bankTransactions.counterpartyName,
        counterpartyIban: schema.bankTransactions.counterpartyIban,
        bankReference: schema.bankTransactions.bankReference,
        accountIban: schema.bankAccounts.iban,
        provider: schema.bankAccounts.provider,
        ledgerIndex: schema.bankAccounts.ledgerIndex,
        purpose: schema.bankAccounts.purpose,
        open: openAmountSql.mapWith(Number),
      })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
      .where(inArray(schema.bankTransactions.id, ids))
      .orderBy(asc(schema.bankTransactions.id))
      .for("update");
    if (rows.length !== ids.length) throw new BankError("Umsatz nicht gefunden.");
    if (rows.some((r) => r.open !== r.amount)) throw new BankError("Beide Umsätze müssen noch ganz offen sein.");
    if (rows.some((r) => !aufKontoAngeboten("geldtransit", r.purpose))) throw new BankError(PRIVAT_NICHT_BUCHBAR);
    // Zwei Seiten: der gewählte Umsatz und die Gegenbuchung; mehrere Umsätze nur als Teile einer Auszahlung
    const sides = [...new Set(rows.map((r) => r.bankAccountId))].map((account) => rows.filter((r) => r.bankAccountId === account));
    if (sides.length !== 2) throw new BankError("Ein Geldtransit verbindet zwei verschiedene Konten.");
    if (rows.reduce((s, r) => s + r.amount, 0) !== 0) throw new BankError("Die beiden Umsätze haben nicht denselben Betrag mit umgekehrtem Vorzeichen.");
    const parts = sides.find((side) => side.length > 1);
    if (parts) {
      const key = payoutKey(parts[0]!.bankReference);
      if (!parts[0]!.provider || !key || parts.some((p) => payoutKey(p.bankReference) !== key) || sides.some((side) => side !== parts && side.length > 1)) {
        throw new BankError("Mehrere Umsätze lassen sich nur als Teile derselben Auszahlung eines Zahlungsdienstleisters verbinden.");
      }
    }
    const [first, second] = sides.map((side) => side[0]!);
    if (!first || !second) throw new BankError("Umsatz nicht gefunden.");
    const provider = [first, second].find((r) => r.provider);
    if (provider) {
      // Zahlungsdienstleister ohne IBAN: die Bankseite muss ihn als Gegenpartei nennen (Auszahlung von PayPal)
      const bankSide = provider === first ? second : first;
      const pattern = providerPattern(provider);
      if (bankSide.provider || !pattern || !pattern.test(bankSide.counterpartyName)) {
        throw new BankError("Auf dem Bankkonto ist nicht der Zahlungsdienstleister die Gegenpartei.");
      }
    } else {
      // Nennt eine Seite ein Gegenkonto, muss es das andere eigene Konto sein, und mindestens eine muss es nennen;
      // sonst ist es eine fremde Zahlung über denselben Betrag (Erstattung, Kunde)
      const pointsTo = (a: typeof first, b: typeof first) => a.counterpartyIban === b.accountIban;
      const named = [first, second].filter((r) => r.counterpartyIban);
      if (named.length === 0 || (first.counterpartyIban && !pointsTo(first, second)) || (second.counterpartyIban && !pointsTo(second, first))) {
        throw new BankError("Die beiden Umsätze nennen nicht das jeweils andere Konto als Gegenkonto.");
      }
    }
    for (const bank of rows) {
      const [allocation] = await insertAllocation(tx, { transactionId: bank.id, kind: "geldtransit", amount: bank.amount });
      await post(tx, company, {
        date: bank.bookingDate,
        description: `${bank.counterpartyName || "Bankumsatz"} · geldtransit`,
        sourceType: "allocation",
        sourceId: allocation!.id,
        lines: onLedger(directPosting("geldtransit", bank.amount, company.kontenrahmen, company.rechtsform), company.kontenrahmen, bank.ledgerIndex),
      });
    }
  }
}
