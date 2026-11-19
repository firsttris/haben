import { addDays } from "@haben/core";
import { and, eq, gte, inArray, isNotNull, max, ne, notInArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "../../db/index.ts";

/*
 * Andere Importe eines Kontos (Datei, FinTS, Abruf vor der Bindung) aus Sicht einer Lieferung des Importvertrags (#306):
 * welche Umsätze vor dem Fenster schon dastehen und welche Tage als abgerufen zählen.
 */

/** Letzter Buchungstag aus einem Dateiimport oder einem anderen Abrufweg als `format` */
export async function lastOtherBooking(q: Pick<Tx, "select">, accountId: string, format: "enablebanking" | "fints"): Promise<string | null> {
  const [row] = await q
    .select({ date: max(schema.bankTransactions.bookingDate) })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), ne(schema.bankImports.format, format)));
  return row?.date ?? null;
}

/**
 * Stichtag einer neuen Quellenbindung: der Tag, ab dem der Abruf das Konto abdeckt. Das ist der Tag nach dem letzten
 * Umsatz aus Datei oder FinTS, nicht vor „Umsätze abrufen ab“ und nicht nach dem Beginn dieses Fensters; ohne beides das
 * Fenster selbst. Umsätze aus Enable Banking vor der Bindung zählen nicht: Die Überlappung mit ihnen deckt der Alias ab,
 * und ein Stichtag nach ihrem letzten Tag ließe einen später am selben Tag gebuchten Umsatz fallen.
 */
export async function cutoverFor(tx: Tx, accountId: string, windowFrom: string, fetchFrom: string | undefined): Promise<string> {
  const last = await lastOtherBooking(tx, accountId, "enablebanking");
  const afterOther = last ? addDays(last, 1) : undefined;
  const floor = [fetchFrom, afterOther]
    .filter((d): d is string => d !== undefined)
    .sort()
    .at(-1);
  return floor && floor < windowFrom ? floor : windowFrom;
}

/**
 * Umsätze aus Dateien und FinTS (nicht aus Enable Banking) an diesen Tagen, je Tag und Betrag. Deren Tage holt der Abruf
 * absichtlich nicht (`followUpStart`); liefert die Bank einen Umsatz mit so einem Tag vor dem Fenster mit, steht er meist
 * schon aus der Datei da, oft mit anders geschriebenem Verwendungszweck. Zeilen, die schon einer Bewegung gehören oder in
 * diesem Abruf per Alias eine bekommen, zählen nicht. Mit `since` nur Zeilen ab diesem Zeitpunkt: Was vor der Bindung
 * importiert wurde, liegt vor ihrem Stichtag, und Bewegungen davor lehnt der Vertrag schon ab.
 */
export async function otherImports(tx: Tx, accountId: string, dates: string[], aliased: string[], since?: Date): Promise<Map<string, string[]>> {
  if (dates.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.bankTransactions.id, date: schema.bankTransactions.bookingDate, amount: schema.bankTransactions.amount })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(
      and(
        eq(schema.bankTransactions.bankAccountId, accountId),
        ne(schema.bankImports.format, "enablebanking"),
        inArray(schema.bankTransactions.bookingDate, [...new Set(dates)]),
        sql`not exists (select 1 from import_movements m where m.transaction_id = ${schema.bankTransactions.id})`,
        ...(aliased.length > 0 ? [notInArray(schema.bankTransactions.id, aliased)] : []),
        ...(since ? [gte(schema.bankTransactions.createdAt, since)] : []),
      ),
    )
    .orderBy(schema.bankTransactions.createdAt, schema.bankTransactions.id);
  const ids = new Map<string, string[]>();
  for (const r of rows) ids.set(`${r.date}|${r.amount}`, [...(ids.get(`${r.date}|${r.amount}`) ?? []), r.id]);
  return ids;
}

/** Zeiträume der anderen Importe des Kontos: Zeitraum des Auszugs, ohne ihn erster bis letzter Buchungstag */
export async function otherRanges(tx: Tx, accountId: string, ownImportId: string): Promise<{ from: string; to: string }[]> {
  const rows = await tx
    .select({
      from: sql<string | null>`coalesce(${schema.bankImports.periodFrom}, min(${schema.bankTransactions.bookingDate}))::text`,
      to: sql<string | null>`coalesce(${schema.bankImports.periodTo}, max(${schema.bankTransactions.bookingDate}))::text`,
    })
    .from(schema.bankImports)
    .leftJoin(schema.bankTransactions, eq(schema.bankTransactions.importId, schema.bankImports.id))
    .where(
      and(
        eq(schema.bankImports.bankAccountId, accountId),
        // Der Import dieses Abrufs hat noch keine Zeile in import_batches
        ne(schema.bankImports.id, ownImportId),
        sql`not exists (select 1 from import_batches b where b.bank_import_id = ${schema.bankImports.id})`,
      ),
    )
    .groupBy(schema.bankImports.id);
  return rows.filter((r): r is { from: string; to: string } => r.from !== null && r.to !== null && r.from <= r.to);
}

/** Die Zeiträume, die über andere hinweg lückenlos an das Fenster anschließen oder es überlappen */
export function connectedRanges(window: { from: string; to: string }, ranges: { from: string; to: string }[]) {
  let { from, to } = window;
  const rest = [...ranges];
  const connected: { from: string; to: string }[] = [];
  for (let i = rest.findIndex(touches); i >= 0; i = rest.findIndex(touches)) {
    const [r] = rest.splice(i, 1);
    connected.push(r!);
    if (r!.from < from) from = r!.from;
    if (r!.to > to) to = r!.to;
  }
  return connected;

  function touches(r: { from: string; to: string }) {
    return r.from <= addDays(to, 1) && r.to >= addDays(from, -1);
  }
}

/**
 * Stichtag je Konto mit Quellenbindung, für die Anzeige am Abruf: ab diesem Tag kommen die Umsätze aus dem Bankabruf;
 * `filesBefore`, wenn davor Umsätze aus Dateien oder FinTS stehen (jedes Format außer `enablebanking`)
 */
export async function cutoverDates(): Promise<{ bankAccountId: string; cutoverDate: string; filesBefore: boolean }[]> {
  const rows = await db
    .select({
      bankAccountId: schema.importSources.bankAccountId,
      cutoverDate: schema.importSources.cutoverDate,
      filesBefore: sql<boolean>`exists (select 1 from bank_transactions t join bank_imports i on i.id = t.import_id
        where t.bank_account_id = import_sources.bank_account_id and i.format <> 'enablebanking'
        and t.booking_date < import_sources.cutover_date)`,
    })
    .from(schema.importSources)
    .where(isNotNull(schema.importSources.cutoverDate));
  return rows.map((r) => ({ bankAccountId: r.bankAccountId, cutoverDate: r.cutoverDate!, filesBefore: r.filesBefore }));
}
