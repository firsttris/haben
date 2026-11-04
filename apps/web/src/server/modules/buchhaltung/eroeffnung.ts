import { ACCOUNTS, type Cents, type KontoSaldo, type Kontenrahmen } from "@haben/core";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Eröffnungen im Journal (Herkunft „eroeffnung“): von Hand erfasst oder aus der Schlussbilanz des DATEV-Stapels
 * vorgeschlagen. Die aus dem Stapel trägt als sourceId die archivierte Stapel-Datei (archive_files.id), ihren Beleg; daran
 * erkennen Kassenbuch, Übernahme offener Posten und Anlagenverzeichnis, dass ihre Bestände schon in der Eröffnung stehen.
 */

type Q = Db | Tx;

export interface Eroeffnung {
  id: string;
  date: string;
  /** Aus dem DATEV-Stapel (sourceId ist eine Archivdatei), sonst von Hand */
  ausStapel: boolean;
}

const e = schema.journalEntries;
const l = schema.journalLines;
const reversal = alias(schema.journalEntries, "reversal");

/** Eröffnungen, die nicht storniert sind, ohne die Gegenbuchungen selbst; nach Datum */
export async function activeOpenings(q: Q = db): Promise<Eroeffnung[]> {
  const rows = await q
    .select({
      id: e.id,
      date: e.date,
      ausStapel: sql<boolean>`exists (select 1 from ${schema.archiveFiles} f where f.id = ${e.sourceId})`,
    })
    .from(e)
    .leftJoin(reversal, eq(reversal.reversesId, e.id))
    .where(and(eq(e.sourceType, "eroeffnung"), isNull(e.reversesId), isNull(reversal.id)))
    .orderBy(asc(e.date));
  return rows.map((r) => ({ ...r, ausStapel: Boolean(r.ausStapel) }));
}

/**
 * Die Eröffnung aus dem DATEV-Stapel, die einen Vorgang vom `date` schon enthält: Sie steht nach diesem Tag, ihre
 * Schlussbilanz kennt ihn also. Ein offener Posten oder eine Anlage von davor wird dann nicht noch einmal gegen 9000
 * gebucht, sonst stünde er doppelt in Forderungen, Verbindlichkeiten oder Anlagen.
 *
 * Nimmt vorher die Sperre der Hash-Kette (0065), wie die Eröffnung aus dem Stapel (lockOpenings): Übernahme und
 * Eröffnung laufen so nacheinander, und die spätere sieht die frühere.
 */
export async function stapelOpeningCovering(tx: Tx, date: string): Promise<Eroeffnung | null> {
  await lockOpenings(tx);
  return (await activeOpenings(tx)).find((o) => o.ausStapel && o.date > date) ?? null;
}

/**
 * Sperre für alles, was gegen 9000 eröffnet: die Sperre der Hash-Kette, die jede Buchung ohnehin beim ersten Schreiben
 * nimmt (drizzle/0065). Hier nur früher, damit zwischen Lesen und Buchen niemand eine Übernahme oder Eröffnung bucht.
 * Wer auch die Kasse sperrt, sperrt sie vorher (siehe lockCash).
 */
export async function lockOpenings(tx: Tx): Promise<void> {
  await tx.execute(sql`select haben_lock_audit_chain()`);
}

/**
 * Was ohne eigene Buchung auf einer Eröffnung aufbaut: übernommene Rechnungen und Belege aus Lexoffice oder sevDesk, die
 * nicht gegen 9000 gebucht wurden, weil die Eröffnung aus dem Stapel sie schon enthält, und Anlagen, die auf die Eröffnung
 * verweisen. Ein Storno nähme ihre Bestände mit, ohne dass sie danach irgendwo stünden.
 */
export async function openingDependents(q: Q, entryId: string): Promise<{ uebernahmen: number; anlagen: number }> {
  const [row] = await q.execute<{ uebernahmen: number; anlagen: number }>(sql`
    select
      (select count(*)::int from invoices i where i.lexoffice_voucher_id is not null
         and not exists (select 1 from journal_entries j where j.source_type = 'invoice' and j.source_id = i.id))
      + (select count(*)::int from documents d where d.lexoffice_voucher_id is not null
         and not exists (select 1 from journal_entries j where j.source_type = 'document' and j.source_id = d.id)) as uebernahmen,
      (select count(*)::int from assets a where a.opening_entry_id = ${entryId}) as anlagen`);
  return { uebernahmen: row?.uebernahmen ?? 0, anlagen: row?.anlagen ?? 0 };
}

/** Erste Buchung vor einem Tag, oder null */
export async function firstEntryBefore(q: Q, date: string): Promise<string | null> {
  const [row] = await q.select({ date: e.date }).from(e).where(lt(e.date, date)).orderBy(asc(e.date)).limit(1);
  return row?.date ?? null;
}

/**
 * Was Übernahmen aus der bisherigen Buchhaltung ab einem Tag gegen 9000 gebucht haben, je Konto (Soll − Haben):
 * offene Rechnungen und Belege aus Lexoffice oder sevDesk und die Eröffnung übernommener Anlagen. Die Eröffnung aus dem
 * Stapel rechnet sie heraus. `spaeter` sind Übernahmen nach dem Ende des Jahres; die lassen sich nicht herausrechnen.
 */
export async function takeoverBalances(q: Q, from: string, to: string): Promise<{ salden: KontoSaldo[]; spaeter: string | null }> {
  const invoices = q.select({ id: schema.invoices.id }).from(schema.invoices).where(isNotNull(schema.invoices.lexofficeVoucherId));
  const documents = q.select({ id: schema.documents.id }).from(schema.documents).where(isNotNull(schema.documents.lexofficeVoucherId));
  const assets = q.select({ id: schema.assets.openingEntryId }).from(schema.assets).where(isNotNull(schema.assets.openingEntryId));
  const takeover = and(
    gte(e.date, from),
    or(
      and(eq(e.sourceType, "invoice"), inArray(e.sourceId, invoices)),
      and(eq(e.sourceType, "document"), inArray(e.sourceId, documents)),
      and(eq(e.sourceType, "asset"), inArray(e.id, assets)),
    ),
  );
  const rows = await q
    .select({ account: l.account, saldo: sql<string>`sum(${l.debit} - ${l.credit})` })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(takeover, lt(e.date, to)))
    .groupBy(l.account);
  const [later] = await q
    .select({ date: e.date })
    .from(e)
    .where(and(takeover, gte(e.date, to)))
    .limit(1);
  return {
    salden: rows.map((r) => ({ account: r.account, saldo: Number(r.saldo) })).filter((r) => r.saldo !== 0),
    spaeter: later?.date ?? null,
  };
}

/**
 * Kassenbestand aus Eröffnungen je Tag: Die Eröffnung aus dem Stapel bucht den Bestand der Kasse zum 1. Januar direkt
 * im Journal; das Kassenbuch zählt ihn zum Anfangsbestand, ohne eigene Zeile und ohne zweite Buchung. Ein Storno der
 * Eröffnung ist selbst eine Eröffnung und nimmt den Bestand wieder heraus.
 */
export async function openingCash(q: Q = db): Promise<{ date: string; amount: Cents }[]> {
  const kasse = (kr: Kontenrahmen) => and(eq(e.kontenrahmen, kr), eq(l.account, ACCOUNTS[kr].kasse));
  const rows = await q
    .select({ date: e.date, amount: sql<string>`sum(${l.debit} - ${l.credit})` })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(eq(e.sourceType, "eroeffnung"), or(kasse("SKR03"), kasse("SKR04"))))
    .groupBy(e.date)
    .orderBy(asc(e.date));
  return rows.map((r) => ({ date: r.date, amount: Number(r.amount) })).filter((r) => r.amount !== 0);
}

/** Gibt es nach `date` schon eine Eröffnung? Dann beginnen die Bücher dort, davor lässt sich nichts buchen */
export async function openingAfter(q: Q, date: string): Promise<string | null> {
  const [row] = await q
    .select({ date: e.date })
    .from(e)
    .where(and(eq(e.sourceType, "eroeffnung"), gt(e.date, date)))
    .limit(1);
  return row?.date ?? null;
}
