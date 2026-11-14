import { desc, gt, lt, sql } from "drizzle-orm";
import { FILE_REFERENCES } from "../../db/file-in-use.ts";
import { db, schema } from "../../db/index.ts";
import type { FileCheckProblem } from "../../db/schema.ts";
import { checkFile } from "../../storage.ts";

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
  /** Datensätze mit fehlender, veränderter oder nicht lesbarer Datei */
  problemCount: number;
  /** Die ersten MAX_FILE_PROBLEMS davon */
  problems: FileProblem[];
}

/** Gespeichert und angezeigt werden so viele Befunde; ist das ganze Volume nicht eingehängt, wären es sonst Tausende */
export const MAX_FILE_PROBLEMS = 100;

const DAY = 24 * 60 * 60 * 1000;
/** Ältere Läufe löscht der nächste Lauf */
const RETENTION_DAYS = 90;

type Reference = {
  tabelle: string;
  zeile: string;
  datei: string;
  sha256: string;
};

/** Alle Verweise aus FILE_REFERENCES, gruppiert nach Datei */
async function referencesByFile(): Promise<Map<string, Reference[]>> {
  const parts = FILE_REFERENCES.map(
    (r) =>
      sql`select cast(${r.table} as text) as tabelle, id::text as zeile, ${sql.identifier(r.nameColumn)} as datei, ${sql.identifier(r.column)} as sha256
        from ${sql.identifier(r.table)} where ${sql.identifier(r.column)} is not null`,
  );
  const rows = await db.execute<Reference>(sql`${sql.join(parts, sql` union all `)} order by sha256, tabelle, zeile`);
  const byFile = new Map<string, Reference[]>();
  for (const row of rows) byFile.set(row.sha256, [...(byFile.get(row.sha256) ?? []), row]);
  return byFile;
}

async function fileProblem(sha256: string): Promise<FileProblem["befund"] | null> {
  try {
    const result = await checkFile(sha256);
    return result === "ok" ? null : result;
  } catch {
    return "nicht lesbar";
  }
}

/** Liest die Dateien nacheinander und gestreamt: Der Lauf hält keine andere Anfrage auf, nur er selbst dauert. */
async function check(now: Date): Promise<FileCheck> {
  const byFile = await referencesByFile();
  const problems: FileProblem[] = [];
  let problemCount = 0;
  for (const [sha256, references] of byFile) {
    const befund = await fileProblem(sha256);
    if (!befund) continue;
    for (const reference of references) {
      problemCount++;
      if (problems.length < MAX_FILE_PROBLEMS) problems.push({ ...reference, befund });
    }
  }
  const result: FileCheck = { at: now, files: byFile.size, problemCount, problems };
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

/** Der letzte gespeicherte Lauf, ohne die Dateien erneut zu lesen */
export async function lastFileCheck(): Promise<FileCheck | null> {
  const [row] = await db
    .select({ at: schema.fileChecks.at, files: schema.fileChecks.files, problemCount: schema.fileChecks.problemCount, problems: schema.fileChecks.problems })
    .from(schema.fileChecks)
    .orderBy(desc(schema.fileChecks.at), desc(schema.fileChecks.id))
    .limit(1);
  return row ?? null;
}

/** Für den Scheduler: einmal am Tag */
export async function runDueFileCheck(now = new Date()): Promise<FileCheck | null> {
  const [recent] = await db
    .select({ id: schema.fileChecks.id })
    .from(schema.fileChecks)
    .where(gt(schema.fileChecks.at, new Date(now.getTime() - DAY)))
    .limit(1);
  return recent ? null : runFileCheck(now);
}
