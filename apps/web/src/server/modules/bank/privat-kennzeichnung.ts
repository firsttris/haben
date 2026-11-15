import { eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Leseseite der Kennzeichnung „privat, kein Betriebsvorgang" (#1088). Die Markierung selbst schreibt `privat.ts`;
 * hier steht, wie Liste und Kontoübersicht sie lesen, damit `listAccounts` und `listTransactions` dieselbe Fassung
 * benutzen und ein gekennzeichneter Umsatz nirgends mehr als offener Posten zählt.
 */

/** Bedingung: der Umsatz ist nicht als privat gekennzeichnet */
export function nichtPrivat(): SQL {
  return sql`not exists (select 1 from ${schema.bankPrivateMarks} m where m.transaction_id = ${schema.bankTransactions.id})`;
}

/** Anzahl der gekennzeichneten Umsätze eines Kontos */
export async function zaehlePrivat(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bankPrivateMarks)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.bankPrivateMarks.transactionId))
    .where(eq(schema.bankTransactions.bankAccountId, accountId));
  return row?.n ?? 0;
}

/** Zweck des Kontos und bestehende Kennzeichnung, für den Panel eines Umsatzes */
export async function privatStand(transactionId: string, bankAccountId: string): Promise<{ privatKonto: boolean; privat: boolean }> {
  const [konto] = await db.select({ purpose: schema.bankAccounts.purpose }).from(schema.bankAccounts).where(eq(schema.bankAccounts.id, bankAccountId));
  const [marke] = await db
    .select({ transactionId: schema.bankPrivateMarks.transactionId })
    .from(schema.bankPrivateMarks)
    .where(eq(schema.bankPrivateMarks.transactionId, transactionId));
  return { privatKonto: konto?.purpose === "privat", privat: marke !== undefined };
}
