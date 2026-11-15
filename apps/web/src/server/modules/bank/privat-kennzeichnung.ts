import { and, eq, sql, type SQL } from "drizzle-orm";
import { bankNotPrivateMarkedSql, bankPrivateMarkedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";

/*
 * Leseseite der Kennzeichnung „privat, kein Betriebsvorgang" (#1088). Die Markierung selbst schreibt `privat.ts`;
 * hier steht, wie Liste und Kontoübersicht sie lesen, damit `listAccounts` und `listTransactions` dieselbe Fassung
 * benutzen und ein gekennzeichneter Umsatz nirgends mehr als offener Posten zählt. Wann die Kennzeichnung wirkt (nur
 * auf einem privaten Konto, nur ganz offen), steht in `bankPrivateMarkedSql`.
 */

/** Bedingung: der Umsatz ist nicht als privat gekennzeichnet; dieselbe wie in der Vorprüfung der Voranmeldung */
export function nichtPrivat(): SQL {
  return bankNotPrivateMarkedSql;
}

/** Bedingung: die Kennzeichnung wirkt; für die Spalte `privat` der Liste */
export function privat(): SQL<boolean> {
  return bankPrivateMarkedSql;
}

/** Anzahl der Umsätze eines Kontos, deren Kennzeichnung wirkt */
export async function zaehlePrivat(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), bankPrivateMarkedSql));
  return row?.n ?? 0;
}

/** Zweck des Kontos und wirksame Kennzeichnung, für den Panel eines Umsatzes */
export async function privatStand(transactionId: string, bankAccountId: string): Promise<{ privatKonto: boolean; privat: boolean }> {
  const [konto] = await db.select({ purpose: schema.bankAccounts.purpose }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, bankAccountId));
  const [marke] = await db
    .select({ id: schema.bankTransactions.id })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.id, transactionId), bankPrivateMarkedSql));
  return { privatKonto: konto?.purpose === "privat", privat: marke !== undefined };
}
