import { and, desc, gt, lt, lte, sql } from "drizzle-orm";
import { FILE_REFERENCES, fileInUse } from "../../db/file-in-use.ts";
import { db, schema } from "../../db/index.ts";
import type { FileCheckProblem } from "../../db/schema.ts";
import { checkFiles } from "../../storage.ts";

/**
 * Vollprüfung des Dokumentenspeichers (#857): Jede Datei, auf die ein Datensatz verweist, muss vorhanden sein und zu
 * ihrem SHA-256 passen. Beim Öffnen prüft Haben das ohnehin; ohne diesen Lauf fiele eine fehlende Datei aber erst auf,
 * wenn jemand genau diesen Beleg öffnet. Nach den GoBD erfüllt die Ablage im Dateisystem die Unveränderbarkeit nur mit
 * zusätzlichen Maßnahmen (Rz. 110).
 */

export type FileProblem = FileCheckProblem;

export interface FileCheck {
  at: Date;
  /** Geprüfte Dateien; eine Datei mit mehreren Verweisen zählt einmal */
  files: number;
  /** Dateien, die fehlen, verändert oder nicht lesbar sind */
  problemCount: number;
  /** Die ersten MAX_FILE_PROBLEMS davon, je Datei mit dem ersten Datensatz, der auf sie verweist */
  problems: FileProblem[];
}

/** Gespeichert und angezeigt werden so viele Befunde; ist das ganze Volume nicht eingehängt, wären es sonst Tausende */
export const MAX_FILE_PROBLEMS = 100;

const DAY = 24 * 60 * 60 * 1000;
/** Ältere Läufe löscht der nächste Lauf */
const RETENTION_DAYS = 90;

type Reference = {
  tabelle: string;
  art: string;
  zeile: string;
  datei: string;
  sha256: string;
};

/** Je Datei der erste Verweis in der Reihenfolge von FILE_REFERENCES und die Zahl der weiteren */
async function referencesByFile(): Promise<Map<string, { first: Reference; weitere: number }>> {
  const parts = FILE_REFERENCES.map(
    (r, i) =>
      sql`select ${i}::int as ord, cast(${r.table} as text) as tabelle, cast(${r.label} as text) as art, id::text as zeile,
        ${sql.identifier(r.nameColumn)} as datei, ${sql.identifier(r.column)} as sha256
        from ${sql.identifier(r.table)} where ${sql.identifier(r.column)} is not null`,
  );
  const rows = await db.execute<Reference & { ord: number }>(sql`${sql.join(parts, sql` union all `)} order by sha256, ord, zeile`);
  const byFile = new Map<string, { first: Reference; weitere: number }>();
  for (const { ord: _ord, ...row } of rows) {
    const known = byFile.get(row.sha256);
    if (known) known.weitere++;
    else byFile.set(row.sha256, { first: row, weitere: 0 });
  }
  return byFile;
}

/**
 * Liest die Dateien nacheinander und gestreamt (pruefenAlle im GoBD-Kern): Der Lauf hält keine andere Anfrage auf, nur er
 * selbst dauert. Erst der Datensatz, dann die Datei (deleteDocument): Ein Datensatz, der seit dem Lesen der Verweise
 * gelöscht wurde, ist kein Befund.
 */
async function check(now: Date): Promise<FileCheck> {
  const byFile = await referencesByFile();
  const { dateien, befundAnzahl, befunde } = await checkFiles(byFile.keys(), {
    nochGenutzt: (sha256) => db.transaction((tx) => fileInUse(tx, sha256)),
    maxBefunde: MAX_FILE_PROBLEMS,
  });
  const problems: FileProblem[] = [];
  for (const { sha256, befund, ursache } of befunde) {
    // Ohne Inhalt der Datei, nur die Ursache, etwa EACCES nach einer Änderung der Rechte im Volume
    if (ursache) console.warn(`Vollprüfung der Dateien: ${sha256} nicht lesbar (${ursache})`);
    const { first, weitere } = byFile.get(sha256)!;
    problems.push({ ...first, befund, weitere });
  }
  const result: FileCheck = { at: now, files: dateien, problemCount: befundAnzahl, problems };
  await db.insert(schema.fileChecks).values(result);
  await db.delete(schema.fileChecks).where(lt(schema.fileChecks.at, new Date(now.getTime() - RETENTION_DAYS * DAY)));
  return result;
}

/** Ein Lauf zur Zeit: Wer währenddessen startet, bekommt dessen Ergebnis */
let running: Promise<FileCheck> | null = null;

export function runFileCheck(now = new Date()): Promise<FileCheck> {
  running ??= check(now).finally(() => {
    running = null;
  });
  return running;
}

/**
 * Der letzte gespeicherte Lauf, ohne die Dateien erneut zu lesen. Läufe mit Zeitpunkt in der Zukunft (Uhr ging vor,
 * oder eine Zeile von außen; file_checks hat kein Audit-Log) zählen nicht, damit der nächste echte Lauf sie ablöst.
 */
export async function lastFileCheck(now = new Date()): Promise<FileCheck | null> {
  const [row] = await db
    .select({ at: schema.fileChecks.at, files: schema.fileChecks.files, problemCount: schema.fileChecks.problemCount, problems: schema.fileChecks.problems })
    .from(schema.fileChecks)
    .where(lte(schema.fileChecks.at, now))
    .orderBy(desc(schema.fileChecks.at), desc(schema.fileChecks.id))
    .limit(1);
  return row ?? null;
}

/** Für den Scheduler: einmal am Tag */
export async function runDueFileCheck(now = new Date()): Promise<FileCheck | null> {
  const [recent] = await db
    .select({ id: schema.fileChecks.id })
    .from(schema.fileChecks)
    .where(and(gt(schema.fileChecks.at, new Date(now.getTime() - DAY)), lte(schema.fileChecks.at, now)))
    .limit(1);
  return recent ? null : runFileCheck(now);
}
