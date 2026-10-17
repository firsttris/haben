import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "./db/index.ts";

/*
 * Nummernkreise für Rechnungen und Angebote, lückenlos je Jahr.
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

/** Sperrt den Nummernkreis eines Jahres bis zum Ende der Transaktion; mehrfach aufrufbar */
export async function lockNumbering(tx: Tx, kind: NumberKind, year: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`haben.nummernkreis.${kind}.${year}`}))`);
}

/** Letzte vergebene Nummer des Jahres (0 = noch keine), unter der Sperre des Kreises gelesen */
async function lastNumber(tx: Tx, kind: NumberKind, year: number): Promise<number> {
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
