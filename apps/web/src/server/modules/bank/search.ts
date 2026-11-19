import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { amountInEitherSign, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { bankDuplicateConfirmedSql, bankDuplicatePendingSql, bankNeutralizedSql, bankOpenAmountSql, bankPrivateMarkedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
import { bestaende } from "./darlehen.ts";

export interface BankTransactionHit {
  id: string;
  /** Konto des Umsatzes: Die Bankseite zeigt einen Umsatz nur im gewählten Konto */
  bankAccountId: string;
  bookingDate: string;
  amount: number;
  currency: string;
  counterpartyName: string;
  purpose: string;
  accountName: string;
  /** Hinweis wie in der Liste der Bankseite (`TransactionStatus`), ohne „Vorschlag“: den rechnet erst der Abgleich */
  hint: "bestaetigteDublette" | "dublette" | "verrechnet" | "privat" | "zugeordnet" | "teilweise" | "belegFehlt" | "offen";
  /** Noch nicht zugeordneter Teil in Cent */
  open: number;
  ibanLast4: string | null;
}

/** Hinweis eines Umsatzes wie `mitHinweisen` in umsatzauswahl.ts, nur ohne Vorschlag */
function transactionHint(tx: {
  duplicateConfirmed: boolean;
  duplicatePending: boolean;
  neutralized: boolean;
  privat: boolean;
  open: number;
  amount: number;
}): BankTransactionHit["hint"] {
  if (tx.duplicateConfirmed) return "bestaetigteDublette";
  if (tx.duplicatePending) return "dublette";
  if (tx.neutralized) return "verrechnet";
  if (tx.privat) return "privat";
  if (tx.open === 0) return "zugeordnet";
  if (tx.open !== tx.amount) return "teilweise";
  return tx.amount < 0 ? "belegFehlt" : "offen";
}

/**
 * Suche in Bankumsätzen (#617): Gegenseite, Verwendungszweck, IBAN (ab vier Ziffern nur das Ende), Betrag mit beiden
 * Vorzeichen und Datum. Schnellsuche und Umsatzliste nutzen dieselbe Bedingung, damit „Alle anzeigen“ dieselben Treffer zeigt.
 */
export function bankTransactionMatch(query: string) {
  const bt = schema.bankTransactions;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  const ibanTail = /^\d{4,}$/.test(query.trim()) ? `%${query.trim()}` : null;
  return or(
    unaccentIlike(bt.counterpartyName, pattern),
    unaccentIlike(bt.purpose, pattern),
    ibanTail ? unaccentIlike(bt.counterpartyIban, ibanTail) : unaccentIlike(bt.counterpartyIban, pattern),
    ...(range !== null ? [amountInEitherSign(bt.amount, range)] : []),
    ...(queryDate !== null ? [eq(bt.bookingDate, queryDate)] : []),
  )!;
}

/** Bankumsätze für die Befehlspalette (#617) */
function bankTransactionsPart(query: string, limit: number) {
  const bt = schema.bankTransactions;
  return searchPart(
    {
      id: bt.id,
      bankAccountId: bt.bankAccountId,
      bookingDate: bt.bookingDate,
      amount: bt.amount,
      currency: bt.currency,
      counterpartyName: bt.counterpartyName,
      purpose: bt.purpose,
      counterpartyIban: bt.counterpartyIban,
      accountName: schema.bankAccounts.name,
      duplicateConfirmed: bankDuplicateConfirmedSql.mapWith(Boolean),
      duplicatePending: bankDuplicatePendingSql.mapWith(Boolean),
      neutralized: bankNeutralizedSql,
      privat: bankPrivateMarkedSql.mapWith(Boolean),
      open: sql<number>`${bankOpenAmountSql}`.mapWith(Number),
    },
    (fields) =>
      db
        .select(fields)
        .from(bt)
        .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, bt.bankAccountId))
        .where(
          and(
            // Ein ausgeschlossenes Konto (#462) fehlt wie im Bankabgleich
            isNull(schema.bankAccounts.excludedAt),
            bankTransactionMatch(query),
          ),
        )
        .orderBy(desc(bt.bookingDate), desc(bt.createdAt))
        .limit(limit + 1),
    (rows): { hits: BankTransactionHit[]; more: boolean } => ({
      hits: rows.slice(0, limit).map(({ counterpartyIban, duplicateConfirmed, duplicatePending, neutralized, privat, ...rest }) => ({
        ...rest,
        hint: transactionHint({ duplicateConfirmed, duplicatePending, neutralized, privat, open: rest.open, amount: rest.amount }),
        ibanLast4: counterpartyIban ? counterpartyIban.slice(-4) : null,
      })),
      more: rows.length > limit,
    }),
  );
}

export interface LoanHit {
  id: string;
  name: string;
  lender: (typeof schema.loans.$inferSelect)["lender"];
  openingBalance: number;
  /** Restschuld wie auf der Seite Darlehen: Stand beim Anlegen plus Auszahlungen und Tilgungen */
  balance: number;
  openingDate: string | null;
}

/** Darlehen für die Befehlspalette (#617) */
function loansPart(query: string, limit: number) {
  const l = schema.loans;
  return searchPart(
    { id: l.id, name: l.name, lender: l.lender, openingBalance: l.openingBalance, openingDate: l.openingDate },
    (fields) =>
      db
        .select(fields)
        .from(l)
        .where(unaccentIlike(l.name, likePattern(query)))
        .orderBy(asc(l.name))
        .limit(limit + 1),
    async (rows): Promise<{ hits: LoanHit[]; more: boolean }> => {
      const { hits, more } = firstHits(rows, limit);
      const bewegt = await bestaende(
        hits.map((loan) => loan.id),
        db,
      );
      return { hits: hits.map((loan) => ({ ...loan, balance: loan.openingBalance + (bewegt.get(loan.id) ?? 0) })), more };
    },
  );
}

export interface CashEntryHit {
  id: string;
  number: number;
  date: string;
  amount: number;
  text: string;
  kind: string;
  /** Durch eine Gegenbuchung storniert, wie „storniert“ in der Kasse */
  reversed: boolean;
}

/** Kassenbuch für die Befehlspalette (#617): Nummer, Text, Betrag (±) und Datum */
function cashEntriesPart(query: string, limit: number) {
  const ce = schema.cashEntries;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  const num = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
  return searchPart(
    {
      id: ce.id,
      number: ce.number,
      date: ce.date,
      amount: ce.amount,
      text: ce.text,
      kind: ce.kind,
      reversed: sql<boolean>`exists(select 1 from cash_entries r where r.reverses_id = ${ce}.id)`,
    },
    (fields) =>
      db
        .select(fields)
        .from(ce)
        .where(
          or(
            unaccentIlike(ce.text, pattern),
            ...(num !== null && Number.isSafeInteger(num) && num <= 2_147_483_647 ? [eq(ce.number, num)] : []),
            ...(range !== null ? [amountInEitherSign(ce.amount, range)] : []),
            ...(queryDate !== null ? [eq(ce.date, queryDate)] : []),
          ),
        )
        .orderBy(numberRank(sql`${ce.number}::text`, query), desc(ce.date), desc(ce.number))
        .limit(limit + 1),
    (rows): { hits: CashEntryHit[]; more: boolean } => firstHits(rows, limit),
  );
}

/** Teile der gemeinsamen Abfrage der Bank, nur die gefragten Gruppen; eigene Funktion, damit ein Test ihren Plan prüft */
export function bankSearchParts(query: string, groups: readonly string[], limit = 5) {
  return partsFor(groups, {
    bankTransactions: () => bankTransactionsPart(query, limit),
    loans: () => loansPart(query, limit),
    cashEntries: () => cashEntriesPart(query, limit),
  });
}

/** Bankumsätze, Darlehen und Kasse für die Befehlspalette in einer Abfrage */
export function searchBank(query: string, groups: readonly string[], limit = 5) {
  return runSearchParts(bankSearchParts(query, groups, limit));
}
