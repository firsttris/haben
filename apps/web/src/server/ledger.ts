import type { Cents, KontenblattZeile, Kontenrahmen, PostingLine, SaldenZeile } from "@haben/core";
import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany, type Company } from "./company.ts";
import { db, schema, type Tx } from "./db/index.ts";
import { accountName } from "./journal.ts";
import { UserError } from "./errors.ts";

/*
 * Hauptbuch: einzige Stelle, die ins Journal schreibt (post), dazu Saldenliste und Kontenblatt.
 * Ein Test (ledger-writer.test.ts) stellt sicher, dass keine andere Datei journal_entries oder journal_lines beschreibt.
 */

export class LedgerError extends UserError {}

/** Was eine Buchung von den Firmendaten braucht: Kontenrahmen, Versteuerung und Kleinunternehmer */
export type Books = Pick<Company, "kontenrahmen" | "versteuerung" | "kleinunternehmer">;

/** Firmendaten für Buchungen, gelesen in der buchenden Transaktion */
export async function openBooks(tx: Tx): Promise<Company> {
  return loadCompany(tx);
}

export interface Posting {
  date: string;
  description: string;
  sourceType: (typeof schema.journalEntries.$inferInsert)["sourceType"];
  sourceId: string;
  /** Storno: die aufgehobene Buchung */
  reversesId?: string | null;
  lines: PostingLine[];
}

/**
 * Bucht und schreibt fest: Buchung anlegen, Zeilen anlegen, sperren. Beim Sperren prüft die Datenbank Soll = Haben und
 * setzt das Siegel (drizzle/0058, 0063); eine Buchung, die bis zum Commit nicht gesperrt ist, lehnt sie ab (0065).
 *
 * `books` sind die Firmendaten, nach denen die Zeilen berechnet wurden. Nach dem Einfügen hält die Transaktion die Sperre
 * der Hash-Kette, Firmendaten ändern sich bis zum Commit nicht mehr (0065). Weichen sie dann von `books` ab, hat sie jemand
 * dazwischen geändert, und die Buchung wird abgelehnt statt mit veralteten Einstellungen festgeschrieben.
 */
export async function post(tx: Tx, books: Books, posting: Posting): Promise<string> {
  const [entry] = await tx
    .insert(schema.journalEntries)
    .values({
      date: posting.date,
      description: posting.description,
      sourceType: posting.sourceType,
      sourceId: posting.sourceId,
      kontenrahmen: books.kontenrahmen,
      reversesId: posting.reversesId ?? null,
    })
    .returning({ id: schema.journalEntries.id });
  const current = await loadCompany(tx);
  if (current.kontenrahmen !== books.kontenrahmen || current.versteuerung !== books.versteuerung || current.kleinunternehmer !== books.kleinunternehmer) {
    throw new LedgerError("Kontenrahmen, Versteuerung oder Kleinunternehmer wurden gerade geändert. Bitte noch einmal buchen.");
  }
  // Ein Jahr hat genau einen Kontenrahmen. Nach einem Wechsel zum Jahreswechsel stünde eine Buchung ins Vorjahr
  // (Storno einer Zuordnung, rückdatierte Rechnung) sonst mit Kontonummern des neuen Rahmens zwischen denen des alten.
  const year = posting.date.slice(0, 4);
  const [other] = await tx
    .select({ kontenrahmen: schema.journalEntries.kontenrahmen })
    .from(schema.journalEntries)
    .where(
      and(
        gte(schema.journalEntries.date, `${year}-01-01`),
        lt(schema.journalEntries.date, `${Number(year) + 1}-01-01`),
        ne(schema.journalEntries.kontenrahmen, books.kontenrahmen),
      ),
    )
    .limit(1);
  if (other) {
    throw new LedgerError(
      `Das Jahr ${year} ist im Kontenrahmen ${other.kontenrahmen} gebucht, eingestellt ist jetzt ${books.kontenrahmen}. In dieses Jahr lässt sich nach dem Wechsel nichts mehr buchen.`,
    );
  }
  const lines = posting.lines.filter((line) => line.debit !== 0 || line.credit !== 0);
  if (lines.length > 0) await tx.insert(schema.journalLines).values(lines.map((line) => ({ entryId: entry!.id, ...line })));
  await tx.update(schema.journalEntries).set({ lockedAt: new Date() }).where(eq(schema.journalEntries.id, entry!.id));
  return entry!.id;
}

/** Zeitraum mit Beginn (einschließlich) und Ende (ausschließlich), beide JJJJ-MM-TT, innerhalb eines Jahres */
export interface LedgerRange {
  from: string;
  to: string;
}

const yearStart = (date: string) => `${date.slice(0, 4)}-01-01`;

/** Saldenliste: jedes im Jahr bebuchte Konto mit Eröffnung ab Jahresbeginn, Soll, Haben und Saldo */
export async function saldenliste({ from, to }: LedgerRange): Promise<SaldenZeile[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await db
    .select({
      kontenrahmen: e.kontenrahmen,
      account: l.account,
      eroeffnung: sql<string>`coalesce(sum(${l.debit} - ${l.credit}) filter (where ${e.date} < ${from}), 0)`,
      soll: sql<string>`coalesce(sum(${l.debit}) filter (where ${e.date} >= ${from}), 0)`,
      haben: sql<string>`coalesce(sum(${l.credit}) filter (where ${e.date} >= ${from}), 0)`,
    })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(gte(e.date, yearStart(from)), lt(e.date, to)))
    .groupBy(e.kontenrahmen, l.account)
    .orderBy(asc(l.account));
  return rows
    .map((r) => {
      const eroeffnung = Number(r.eroeffnung);
      const soll = Number(r.soll);
      const haben = Number(r.haben);
      return {
        kontenrahmen: r.kontenrahmen as Kontenrahmen,
        account: r.account,
        name: accountName(r.kontenrahmen as Kontenrahmen, r.account),
        eroeffnung,
        soll,
        haben,
        saldo: eroeffnung + soll - haben,
      };
    })
    .filter((r) => r.eroeffnung !== 0 || r.soll !== 0 || r.haben !== 0);
}

export interface Kontenblatt {
  account: string;
  name: string;
  kontenrahmen: Kontenrahmen | null;
  eroeffnung: Cents;
  zeilen: (KontenblattZeile & { entryId: string; sourceType: string; sourceId: string; reversal: boolean })[];
  soll: Cents;
  haben: Cents;
  saldo: Cents;
}

/** Alle Buchungen auf einem Konto im Zeitraum mit Gegenkonten und laufendem Saldo */
export async function kontenblatt(account: string, { from, to }: LedgerRange): Promise<Kontenblatt> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const [opening] = await db
    .select({ saldo: sql<string>`coalesce(sum(${l.debit} - ${l.credit}), 0)` })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(eq(l.account, account), gte(e.date, yearStart(from)), lt(e.date, from)));
  const lines = await db
    .select({
      entryId: e.id,
      date: e.date,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      reversesId: e.reversesId,
      kontenrahmen: e.kontenrahmen,
      debit: l.debit,
      credit: l.credit,
    })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    .where(and(eq(l.account, account), gte(e.date, from), lt(e.date, to)))
    .orderBy(asc(e.date), asc(e.createdAt), asc(l.id));
  const others = lines.length
    ? await db
        .select({ entryId: l.entryId, account: l.account })
        .from(l)
        .where(inArray(l.entryId, [...new Set(lines.map((x) => x.entryId))]))
    : [];

  const eroeffnung = Number(opening?.saldo ?? 0);
  let saldo = eroeffnung;
  const zeilen = lines.map((x) => {
    saldo += x.debit - x.credit;
    return {
      entryId: x.entryId,
      sourceType: x.sourceType,
      sourceId: x.sourceId,
      reversal: x.reversesId !== null,
      date: x.date,
      description: x.description,
      gegenkonten: [...new Set(others.filter((o) => o.entryId === x.entryId && o.account !== account).map((o) => o.account))],
      soll: x.debit,
      haben: x.credit,
      saldo,
    };
  });
  const kontenrahmen = (lines[0]?.kontenrahmen as Kontenrahmen | undefined) ?? null;
  return {
    account,
    name: kontenrahmen ? accountName(kontenrahmen, account) : "",
    kontenrahmen,
    eroeffnung,
    zeilen,
    soll: zeilen.reduce((sum, z) => sum + z.soll, 0),
    haben: zeilen.reduce((sum, z) => sum + z.haben, 0),
    saldo,
  };
}

/** Zeitraum als Text: das ganze Jahr, ein Quartal (q1–q4) oder ein Monat (m1–m12) */
export const ledgerPeriodSchema = z.string().regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/).default("jahr");

/** Zeitraum aus Jahr und optional Monat oder Quartal */
export function ledgerRange(year: number, period?: string): LedgerRange {
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = /^m(\d{1,2})$/.exec(period ?? "");
  const quarter = /^q([1-4])$/.exec(period ?? "");
  if (month && Number(month[1]) >= 1 && Number(month[1]) <= 12) {
    const m = Number(month[1]);
    return { from: `${year}-${pad(m)}-01`, to: m === 12 ? `${year + 1}-01-01` : `${year}-${pad(m + 1)}-01` };
  }
  if (quarter) {
    const q = Number(quarter[1]);
    return { from: `${year}-${pad(q * 3 - 2)}-01`, to: q === 4 ? `${year + 1}-01-01` : `${year}-${pad(q * 3 + 1)}-01` };
  }
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}
