import { ACCOUNTS, type Cents, type Kontenrahmen } from "@haben/core";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Bank gegen Kontoauszug (#1116): je Bankkonto der Endsaldo des letzten Kontoauszugs gegen das Journal. Alle betrieblichen
 * Bankkonten buchen auf dasselbe Sachkonto (SKR03 1200, SKR04 1800); was zu einem Konto gehört, sagen die Zuordnungen der
 * Buchungen. Verglichen wird deshalb: Anfangssaldo des ersten Auszugs mit Salden plus die im Journal gebuchten Zahlungen
 * der Umsätze bis zum Ende des letzten Auszugs mit Salden plus deren noch offener Teil (nicht zugeordnet, also nicht
 * gebucht) gegen dessen Endsaldo.
 * Verrechnete Umsätze (#457) sind ohne Buchung erledigt und heben sich gegenseitig auf.
 *
 * Nur Konten mit Salden im Auszug (CAMT, MT940; nicht jede CSV nennt sie), ohne private Konten (sie buchen auf
 * Privatkonten), ausgeschlossene Konten und Zahlungsdienstleister (sie nennen keinen Kontostand).
 */

export interface BankZeile {
  zeitraum: string;
  posten: string;
  journal: Cents;
  auszug: Cents;
}

export async function bankZeilen(q: Db | Tx = db): Promise<BankZeile[]> {
  const ba = schema.bankAccounts;
  const accounts = await q
    .select({ id: ba.id, name: ba.name })
    .from(ba)
    .where(and(isNull(ba.excludedAt), notInArray(ba.purpose, ["privat", "zahlungsdienstleister"])));
  const result: BankZeile[] = [];
  const bi = schema.bankImports;
  const t = schema.bankTransactions;
  for (const account of accounts) {
    const [erster] = await q
      .select({ periodFrom: bi.periodFrom, openingBalance: bi.openingBalance })
      .from(bi)
      .where(and(eq(bi.bankAccountId, account.id), isNotNull(bi.periodFrom), isNotNull(bi.openingBalance)))
      .orderBy(asc(bi.periodFrom), asc(bi.createdAt))
      .limit(1);
    const [letzter] = await q
      .select({ periodTo: bi.periodTo, closingBalance: bi.closingBalance })
      .from(bi)
      .where(and(eq(bi.bankAccountId, account.id), isNotNull(bi.periodTo), isNotNull(bi.closingBalance)))
      .orderBy(desc(bi.periodTo), desc(bi.createdAt))
      .limit(1);
    if (erster?.openingBalance == null || !erster.periodFrom || letzter?.closingBalance == null || !letzter.periodTo) continue;
    const imZeitraum = and(eq(t.bankAccountId, account.id), gte(t.bookingDate, erster.periodFrom), lte(t.bookingDate, letzter.periodTo));
    const [offen] = await q
      .select({ betrag: sql<string>`coalesce(sum(${bankOpenAmountSql}), 0)` })
      .from(t)
      .where(imZeitraum);
    const gebucht = await q
      .select({
        kontenrahmen: schema.journalEntries.kontenrahmen,
        account: schema.journalLines.account,
        saldo: sql<string>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .innerJoin(schema.allocations, and(eq(schema.journalEntries.sourceType, "allocation"), eq(schema.allocations.id, schema.journalEntries.sourceId)))
      .innerJoin(t, eq(t.id, schema.allocations.transactionId))
      .where(imZeitraum)
      .groupBy(schema.journalEntries.kontenrahmen, schema.journalLines.account);
    const bank = gebucht.filter((g) => g.account === ACCOUNTS[g.kontenrahmen as Kontenrahmen].bank).reduce((s, g) => s + Number(g.saldo), 0);
    const journal = erster.openingBalance + bank + Number(offen!.betrag);
    if (journal !== letzter.closingBalance) {
      result.push({
        zeitraum: letzter.periodTo,
        posten: `Bankkonto „${account.name}“: Anfangssaldo, gebuchte Zahlungen und offene Umsätze gegen den Endsaldo des Kontoauszugs`,
        journal,
        auszug: letzter.closingBalance,
      });
    }
  }
  return result;
}
