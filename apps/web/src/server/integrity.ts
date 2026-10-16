import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/index.ts";

export { formatPruefwert, parsePruefwert } from "../lib/pruefwert.ts";

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
  /** kette: Eintrag im Audit-Log; kopf: Kopf der Kette; siegel: festgeschriebener Datensatz */
  art: "kette" | "kopf" | "siegel";
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
}

export async function chainHead(): Promise<ChainHead | null> {
  const [head] = await db
    .select({ seq: schema.auditChain.seq, hash: schema.auditChain.hash, at: schema.auditLog.at })
    .from(schema.auditChain)
    .leftJoin(schema.auditLog, eq(schema.auditLog.seq, schema.auditChain.seq));
  if (!head) return null;
  return { seq: head.seq, hash: head.hash.toString("hex"), at: head.at };
}

const MAX_ROWS = 100;

/** Prüft die ganze Kette und alle Siegel. Dauert bei großen Datenbanken einige Sekunden. */
export async function checkIntegrity(): Promise<IntegrityReport> {
  const [rows, head, [entries], [seals]] = await Promise.all([
    db.execute<{ art: IntegrityProblem["art"]; tabelle: string; zeile: string | null; seq: string | null; befund: string }>(
      sql`select art, tabelle, zeile, seq, befund from haben_integrity_problems(${MAX_ROWS})`,
    ),
    chainHead(),
    db.select({ n: count() }).from(schema.auditLog),
    db.select({ n: count() }).from(schema.seals),
  ]);
  const problems = [...rows].map((r) => ({ ...r, seq: r.seq === null ? null : Number(r.seq) }));
  const perKind = new Map<string, number>();
  for (const p of problems) perKind.set(`${p.art}:${p.tabelle}`, (perKind.get(`${p.art}:${p.tabelle}`) ?? 0) + 1);
  return {
    head,
    entries: entries!.n,
    seals: seals!.n,
    problems,
    truncated: [...perKind.values()].some((n) => n >= MAX_ROWS),
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
  const [row] = await db
    .select({ hash: schema.auditLog.rowHash })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.seq, seq));
  if (!row) return { status: "fehlt", seq, head: (await chainHead())?.seq ?? null };
  const actual = row.hash.toString("hex");
  if (actual !== hash.toLowerCase()) return { status: "abweichend", seq, expected: hash.toLowerCase(), actual };
  const [broken] = await db.execute<{ seq: string; befund: string }>(
    sql`select seq, befund from haben_integrity_problems(1) where art = 'kette' and seq <= ${seq} order by seq limit 1`,
  );
  return broken ? { status: "beschaedigt", seq, first: Number(broken.seq), befund: broken.befund } : { status: "ok", seq };
}
