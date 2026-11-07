import { counterCircle, formatDocumentNumber } from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/*
 * Nummernkreise für Rechnungen und Angebote, lückenlos je Kreis. Ein Kreis ist das Jahr des Belegdatums oder, wenn der
 * Zähler in den Einstellungen durchläuft, der eine Kreis 0 (counterCircle, #328). Die Funktionen unten nehmen den Kreis.
 *
 * Das Festschreiben erzeugt PDF und XML mit der neuen Nummer. Jede Änderung mit Audit-Eintrag nimmt die Sperre der
 * Hash-Kette bis zum Commit (drizzle/0063), und solange warten alle anderen Schreibvorgänge. Deshalb wird die Nummer
 * zuerst nur gelesen (peekNumber, unter einer eigenen Sperre je Kreis und Jahr), dann entstehen PDF und XML, und erst
 * danach schreibt takeNumber den Zähler. Die Kette ist so nur für das Speichern gesperrt, nicht für das Rendern.
 *
 * Reihenfolge der Sperren: Rechnungszeilen (FOR UPDATE), dann Nummernkreis, dann die Kette. Wer in einer Transaktion
 * schon etwas mit Audit-Eintrag geschrieben hat und danach eine Nummer braucht (Storno: erst der Entwurf), sperrt die
 * betroffenen Zeilen und den Kreis vorher (lockNumbering), sonst können sich zwei Transaktionen gegenseitig blockieren.
 */

export type NumberKind = "rechnung" | "angebot";

const COUNTERS = {
  rechnung: schema.invoiceNumberCounters,
  angebot: schema.quoteNumberCounters,
} as const;

const NUMBERED = {
  rechnung: schema.invoices,
  angebot: schema.quotes,
} as const;

export class NumberTakenError extends UserError {}

/** Ob der Zähler des Kreises durchläuft; nur gelesen, ohne die Firmenzeile anzulegen (loadCompany schriebe Audit) */
export async function countsRunning(tx: Tx, kind: NumberKind): Promise<boolean> {
  const column = kind === "rechnung" ? schema.company.invoiceCounterRunning : schema.company.quoteCounterRunning;
  const [row] = await tx.select({ running: column }).from(schema.company).where(eq(schema.company.id, 1));
  return row?.running ?? false;
}

/** Kreis für ein Belegdatum, nach der Einstellung des Kreises */
export async function circleFor(tx: Tx, kind: NumberKind, date: string): Promise<number> {
  return counterCircle(await countsRunning(tx, kind), date);
}

/**
 * Nummer im Format aus den Einstellungen. Ein Format ergibt nie zweimal dieselbe Nummer (number-format.ts), nach einem
 * Wechsel des Formats kann sie aber mit einer früher vergebenen übereinstimmen; dann lieber eine klare Meldung als die
 * Verletzung des Unique-Index.
 */
export async function documentNumber(tx: Tx, kind: NumberKind, format: string, date: string, counter: number): Promise<string> {
  const number = formatDocumentNumber(format, date, counter);
  const table = NUMBERED[kind];
  const [taken] = await tx.select({ id: table.id }).from(table).where(eq(table.number, number)).limit(1);
  if (taken) {
    throw new NumberTakenError(`Die Nummer ${number} ist schon vergeben. Bitte unter Einstellungen › Rechnungen das Nummernformat anpassen.`);
  }
  return number;
}

/** Sperrt einen Nummernkreis bis zum Ende der Transaktion; mehrfach aufrufbar */
export async function lockNumbering(tx: Tx, kind: NumberKind, year: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`haben.nummernkreis.${kind}.${year}`}))`);
}

/** Letzte vergebene Nummer des Kreises (0 = noch keine), unter der Sperre des Kreises gelesen */
export async function lastNumber(tx: Tx, kind: NumberKind, year: number): Promise<number> {
  const counter = COUNTERS[kind];
  const [row] = await tx.select({ last: counter.last }).from(counter).where(eq(counter.year, year));
  return row?.last ?? 0;
}

/** Nächste Nummer, ohne sie zu verbrauchen. Sperrt den Kreis bis zum Commit; bis dahin vergibt niemand eine Nummer. */
export async function peekNumber(tx: Tx, kind: NumberKind, year: number): Promise<number> {
  await lockNumbering(tx, kind, year);
  return (await lastNumber(tx, kind, year)) + 1;
}

/** Verbraucht die mit peekNumber gelesene Nummer. Schlägt fehl, wenn der Zähler inzwischen woanders steht. */
export async function takeNumber(tx: Tx, kind: NumberKind, year: number, number: number): Promise<void> {
  const counter = COUNTERS[kind];
  const [row] = await tx
    .insert(counter)
    .values({ year, last: number })
    .onConflictDoUpdate({ target: counter.year, set: { last: number }, setWhere: eq(counter.last, number - 1) })
    .returning({ last: counter.last });
  if (!row) throw new Error(`Nummernkreis ${kind} ${year}: Nummer ${number} ist nicht mehr die nächste.`);
}

/** Setzt den Zähler so, dass `next` die nächste Nummer ist (Umstieg von einem anderen Programm) */
export async function setNextNumber(tx: Tx, kind: NumberKind, year: number, next: number): Promise<{ ok: true } | { ok: false; last: number }> {
  await lockNumbering(tx, kind, year);
  const last = await lastNumber(tx, kind, year);
  if (next <= last) return { ok: false, last };
  const counter = COUNTERS[kind];
  await tx
    .insert(counter)
    .values({ year, last: next - 1 })
    .onConflictDoUpdate({ target: counter.year, set: { last: next - 1 } });
  return { ok: true };
}

/**
 * Beim Umschalten auf den durchlaufenden Zähler: Er beginnt hinter der letzten Nummer des jüngsten Jahres, damit
 * „RE-2026-12-0412“ im Januar mit 0413 weitergeht. Steht der Kreis 0 schon (früher einmal durchlaufend), rückt er nur
 * vor, wenn das jüngste Jahr inzwischen weiter ist; sonst ergäbe ein Format mit Jahr eine schon vergebene Nummer.
 */
export async function startRunning(tx: Tx, kind: NumberKind): Promise<void> {
  const counter = COUNTERS[kind];
  await lockNumbering(tx, kind, 0);
  const [latest] = await tx.select({ last: counter.last }).from(counter).where(sql`${counter.year} > 0`).orderBy(sql`${counter.year} desc`).limit(1);
  await tx
    .insert(counter)
    .values({ year: 0, last: latest?.last ?? 0 })
    .onConflictDoUpdate({ target: counter.year, set: { last: sql`excluded.last` }, setWhere: sql`${counter.last} < excluded.last` });
}
