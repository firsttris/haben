import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { asc, desc, eq, or, sql } from "drizzle-orm";
import { amountInEitherSign, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
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
  allocated: boolean;
  ibanLast4: string | null;
}

/** Bankumsätze für die Befehlspalette (#617): Gegenseite, Verwendungszweck, IBAN-Ende, Betrag (±) und Datum */
export async function searchBankTransactions(query: string, limit = 5): Promise<{ hits: BankTransactionHit[]; more: boolean }> {
  const bt = schema.bankTransactions;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  const ibanTail = /^\d{4,}$/.test(query.trim()) ? `%${query.trim()}` : null;

  const rows = await db
    .select({
      id: bt.id,
      bankAccountId: bt.bankAccountId,
      bookingDate: bt.bookingDate,
      amount: bt.amount,
      currency: bt.currency,
      counterpartyName: bt.counterpartyName,
      purpose: bt.purpose,
      counterpartyIban: bt.counterpartyIban,
      accountName: schema.bankAccounts.name,
      // wie der Filter „zugeordnet“ der Bankseite; null heißt mit einem gegenläufigen Umsatz verrechnet (#457)
      allocated: sql<boolean>`coalesce(${bankOpenAmountSql}, 0) = 0`,
    })
    .from(bt)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, bt.bankAccountId))
    .where(
      or(
        unaccentIlike(bt.counterpartyName, pattern),
        unaccentIlike(bt.purpose, pattern),
        ibanTail ? unaccentIlike(bt.counterpartyIban, ibanTail) : unaccentIlike(bt.counterpartyIban, pattern),
        ...(range !== null ? [amountInEitherSign(bt.amount, range)] : []),
        ...(queryDate !== null ? [eq(bt.bookingDate, queryDate)] : []),
      ),
    )
    .orderBy(desc(bt.bookingDate), desc(bt.createdAt))
    .limit(limit + 1);

  return {
    hits: rows.slice(0, limit).map(({ counterpartyIban, ...rest }) => ({
      ...rest,
      ibanLast4: counterpartyIban ? counterpartyIban.slice(-4) : null,
    })),
    more: rows.length > limit,
  };
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
export async function searchLoans(query: string, limit = 5): Promise<{ hits: LoanHit[]; more: boolean }> {
  const rows = await db
    .select({
      id: schema.loans.id,
      name: schema.loans.name,
      lender: schema.loans.lender,
      openingBalance: schema.loans.openingBalance,
      openingDate: schema.loans.openingDate,
    })
    .from(schema.loans)
    .where(unaccentIlike(schema.loans.name, likePattern(query)))
    .orderBy(asc(schema.loans.name))
    .limit(limit + 1);
  const hits = rows.slice(0, limit);
  const bewegt = await bestaende(
    hits.map((l) => l.id),
    db,
  );
  return { hits: hits.map((l) => ({ ...l, balance: l.openingBalance + (bewegt.get(l.id) ?? 0) })), more: rows.length > limit };
}

export interface CashEntryHit {
  id: string;
  number: number;
  date: string;
  amount: number;
  text: string;
  kind: string;
}

/** Kassenbuch für die Befehlspalette (#617): Nummer, Text, Betrag (±) und Datum */
export async function searchCashEntries(query: string, limit = 5): Promise<{ hits: CashEntryHit[]; more: boolean }> {
  const ce = schema.cashEntries;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  const num = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;

  const rows = await db
    .select({
      id: ce.id,
      number: ce.number,
      date: ce.date,
      amount: ce.amount,
      text: ce.text,
      kind: ce.kind,
    })
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
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
