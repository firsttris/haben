import { reservedAccountNumbers, type Kontenrahmen } from "@haben/core";
import { count, eq, sql } from "drizzle-orm";
import { abgleichAll, abweichungen, type AbgleichZeile } from "./abgleich.ts";
import { db, schema } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { today } from "../../today.ts";
import { checkTriggerIntegrity } from "../../db/trigger-inventory.ts";

export { formatPruefwert, parsePruefwert } from "../../../lib/pruefwert.ts";

/**
 * Manipulationserkennung (GoBD): Das Audit-Log ist eine Hash-Kette, festgeschriebene Datensätze tragen ein Siegel.
 * Berechnet und geprüft wird beides in der Datenbank (drizzle/0063_hash_kette_trigger.sql). Wer die Datenbank
 * ändern kann, kann auch die Kette neu berechnen; aufgedeckt wird das erst mit einem Prüfwert von außerhalb des
 * Servers (Jahresarchiv, wöchentliche Mail), siehe checkPruefwert.
 */

/** Kopf der Kette: Nummer und Hash des letzten Eintrags */
export interface ChainHead {
  seq: number;
  hash: string;
  /** Zeitpunkt des letzten Eintrags */
  at: Date | null;
}

export interface IntegrityProblem {
  /** kette: Audit-Log; kopf: Kettenkopf; siegel: festgeschriebener Datensatz; sperre: Trigger oder Funktion */
  art: "kette" | "kopf" | "siegel" | "sperre";
  tabelle: string;
  zeile: string | null;
  seq: number | null;
  befund: string;
}

export interface IntegrityReport {
  head: ChainHead | null;
  entries: number;
  seals: number;
  problems: IntegrityProblem[];
  /** true, wenn eine Art von Befund mehr als die angezeigten hat */
  truncated: boolean;
  /**
   * Abgleich Journal ↔ Umsatzsteuer und EÜR (abgleich.ts): Abweichungen und was nicht verglichen werden konnte.
   * Eine Abweichung ist kein Beweis für eine Manipulation, aber ein Widerspruch in den Büchern, der zu klären ist.
   */
  abgleich: { abweichungen: AbgleichZeile[]; hinweise: string[] };
  /** Eigene Nummern, die eine spätere Version von Haben selbst nutzt; kein Beweis einer Manipulation. */
  accountCollisions: { kontenrahmen: Kontenrahmen; account: string; name: string }[];
  /** Zusätzliche Betreibertrigger sind Hinweise, keine Korruptionsbefunde. */
  triggerHints: string[];
}

/** Lesezugriff auf die Datenbank: db selbst oder eine Transaktion */
type Reader = Pick<typeof db, "select" | "execute">;

export async function chainHead(reader: Reader = db): Promise<ChainHead | null> {
  const [head] = await reader
    .select({ seq: schema.auditChain.seq, hash: schema.auditChain.hash, at: schema.auditLog.at })
    .from(schema.auditChain)
    .leftJoin(schema.auditLog, eq(schema.auditLog.seq, schema.auditChain.seq));
  if (!head) return null;
  return { seq: head.seq, hash: head.hash.toString("hex"), at: head.at };
}

const MAX_ROWS = 100;

/**
 * Befunde, Kopf, Anzahlen und Abgleich aus einem Stand der Datenbank. Einzeln gelesen verschob ein Eintrag, der
 * dazwischen hinzukam, Anzahl und Kopf gegeneinander, und der Abgleich sah eine Buchung nebenher nur auf einer Seite.
 * REPEATABLE READ hält den Stand über alle Abfragen der Transaktion fest.
 */
function readSnapshot(now: string) {
  return db.transaction(
    async (tx) => {
      const rows = await tx.execute<{ art: IntegrityProblem["art"]; tabelle: string; zeile: string | null; seq: string | null; befund: string }>(
        sql`select art, tabelle, zeile, seq, befund from haben_integrity_problems(${MAX_ROWS})`,
      );
      const head = await chainHead(tx);
      const [entries] = await tx.select({ n: count() }).from(schema.auditLog);
      const [seals] = await tx.select({ n: count() }).from(schema.seals);
      const abgleich = await abgleichAll(now, tx);
      // #787: Auch archivierte Konten und frühere Kontenrahmen bestimmen weiterhin die Bedeutung alter Buchungen.
      // https://github.com/firsttris/haben/issues/787#issuecomment-6840030954
      const ownAccounts = await tx
        .select({ kontenrahmen: schema.ownAccounts.kontenrahmen, account: schema.ownAccounts.account, name: schema.ownAccounts.name })
        .from(schema.ownAccounts)
        .orderBy(schema.ownAccounts.kontenrahmen, schema.ownAccounts.account);
      const accountCollisions = ownAccounts.filter((account) => reservedAccountNumbers(account.kontenrahmen).has(account.account));
      const triggers = await checkTriggerIntegrity(tx);
      return { rows: [...rows, ...triggers.problems], triggerHints: triggers.hints, head, entries: entries!.n, seals: seals!.n, abgleich, accountCollisions };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Prüft die ganze Kette, alle Siegel und gleicht Journal und Steuerwerte ab. Dauert bei großen Datenbanken einige Sekunden. */
export async function checkIntegrity(now = today()): Promise<IntegrityReport> {
  // Mit Buchungen liest der Abgleich die Firmendaten. Fehlen sie, legt loadCompany sie an; das ist ein Schreibzugriff
  // und geht in der Transaktion mit festem Stand nicht. Ohne Buchungen bleibt die Prüfung ohne jeden Schreibzugriff.
  const [booking] = await db.select({ id: schema.journalEntries.id }).from(schema.journalEntries).limit(1);
  if (booking) await loadCompany();
  const { rows, triggerHints, head, entries, seals, abgleich, accountCollisions } = await readSnapshot(now);
  const problems = [...rows].map((r) => ({ ...r, seq: r.seq === null ? null : Number(r.seq) }));
  const perKind = new Map<string, number>();
  for (const p of problems) perKind.set(`${p.art}:${p.tabelle}`, (perKind.get(`${p.art}:${p.tabelle}`) ?? 0) + 1);
  return {
    head,
    entries,
    seals,
    problems,
    truncated: [...perKind.values()].some((n) => n >= MAX_ROWS),
    abgleich: { abweichungen: abweichungen(abgleich.zeilen), hinweise: abgleich.hinweise },
    accountCollisions,
    triggerHints,
  };
}

export type PruefwertResult =
  /** Eintrag vorhanden, Hash stimmt und die Kette bis dahin ist nachgerechnet lückenlos: bis hierhin unverändert */
  | { status: "ok"; seq: number }
  /** Hash stimmt, aber ein früherer Eintrag passt nicht mehr zur Kette (bei abgeschalteten Triggern geändert) */
  | { status: "beschaedigt"; seq: number; first: number; befund: string }
  /** Eintrag vorhanden, Hash anders: die Kette wurde bis zu diesem Eintrag neu berechnet */
  | { status: "abweichend"; seq: number; expected: string; actual: string }
  /** Kein Eintrag mit dieser Nummer: Einträge gelöscht oder ein älteres Backup eingespielt */
  | { status: "fehlt"; seq: number; head: number | null };

/**
 * Vergleicht einen Prüfwert von außerhalb (Mail, Jahresarchiv) mit dem Eintrag dieser Nummer und rechnet die Kette
 * bis dorthin nach. Erst beides zusammen zeigt, dass kein Eintrag bis zu dieser Nummer verändert wurde.
 */
export async function checkPruefwert(seq: number, hash: string): Promise<PruefwertResult> {
  const [row] = await db.select({ hash: schema.auditLog.rowHash }).from(schema.auditLog).where(eq(schema.auditLog.seq, seq));
  if (!row) return { status: "fehlt", seq, head: (await chainHead())?.seq ?? null };
  const actual = row.hash.toString("hex");
  if (actual !== hash.toLowerCase()) return { status: "abweichend", seq, expected: hash.toLowerCase(), actual };
  const [broken] = await db.execute<{ seq: string; befund: string }>(
    sql`select seq, befund from haben_integrity_problems(1) where art = 'kette' and seq <= ${seq} order by seq limit 1`,
  );
  return broken ? { status: "beschaedigt", seq, first: Number(broken.seq), befund: broken.befund } : { status: "ok", seq };
}
