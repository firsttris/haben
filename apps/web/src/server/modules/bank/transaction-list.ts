// Umsatzliste eines oder mehrerer Konten mit Filter, Suche und Sortierung

import { and, asc, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { bankNeutralizedSql, bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { STANDARD_SORTIERUNG, umsatzReihenfolge, type UmsatzSortierung } from "./umsatzliste.ts";
import { bankTransactionMatch } from "./search.ts";
import { nichtPrivat, privat } from "./privat-kennzeichnung.ts";

type TransactionFilter = "offen" | "zugeordnet" | "alle";

export const UMSATZ_LISTENLIMIT = 500;

/** Höchstens 500 Umsätze, sortiert vor der Grenze (umsatzliste.ts); ohne Sortierung der neueste oben */
export async function listTransactions(
  accountIds: string | readonly string[],
  filter: TransactionFilter,
  search: string,
  sortierung: UmsatzSortierung = STANDARD_SORTIERUNG,
  offset?: number,
) {
  // Mehrere Konten in „Alle Konten“ der Bankseite, wohin „Alle anzeigen“ der Schnellsuche führt (#617)
  const conditions = [inArray(schema.bankTransactions.bankAccountId, typeof accountIds === "string" ? [accountIds] : [...accountIds])];
  if (filter === "offen") conditions.push(sql`${openAmountSql} <> 0`, nichtPrivat());
  if (filter === "zugeordnet") conditions.push(sql`${openAmountSql} = 0`);
  if (search.trim()) {
    // Wie die Schnellsuche, dazu der Betrag als Text („19.9“ findet 19,90 €)
    conditions.push(
      or(bankTransactionMatch(search), sql`(${schema.bankTransactions.amount}::numeric / 100)::text like ${`%${search.trim().replace(",", ".")}%`}`)!,
    );
  }
  const order = umsatzReihenfolge(sortierung);
  // Beim seitenweisen Lesen braucht auch ein Gleichstand eine eindeutige Reihenfolge.
  if (offset !== undefined) order.push(asc(schema.bankTransactions.id));
  return db
    .select({
      /** Auf einem privaten Konto als „kein Betriebsvorgang" gekennzeichnet und ganz offen (#1088) */
      privat: privat().mapWith(Boolean),
      id: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      bookingDate: schema.bankTransactions.bookingDate,
      amount: schema.bankTransactions.amount,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      purpose: schema.bankTransactions.purpose,
      bankReference: schema.bankTransactions.bankReference,
      endToEndId: schema.bankTransactions.endToEndId,
      open: openAmountSql.mapWith(Number),
      neutralized: bankNeutralizedSql.mapWith(Boolean),
    })
    .from(schema.bankTransactions)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(UMSATZ_LISTENLIMIT)
    .offset(offset ?? 0);
}
