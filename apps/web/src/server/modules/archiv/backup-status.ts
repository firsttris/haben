import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/**
 * Stand des Backups aus der Tabelle backup_status, die der Backup-Container (deploy/backup) nach jedem Lauf
 * schreibt: tägliches Backup und wöchentlicher Test-Restore. Die App liest nur.
 */

export type BackupKind = (typeof schema.backupStatus.$inferSelect)["kind"];

export interface BackupRun {
  at: Date;
  ok: boolean;
  snapshot: string | null;
  bytes: number | null;
  message: string;
}

export interface BackupOverview {
  /** keins: noch nie ein Lauf; fehler: der letzte Backup- oder Testlauf schlug fehl; veraltet: kein Backup seit zwei Tagen */
  state: "keins" | "ok" | "veraltet" | "fehler";
  /** Kein erfolgreiches Backup seit zwei Tagen, auch wenn state wegen eines Fehlschlags „fehler“ ist */
  overdue: boolean;
  lastBackup: BackupRun | null;
  lastCheck: BackupRun | null;
  /** Der letzte Lauf je Art, wenn er fehlschlug */
  failed: { kind: BackupKind; run: BackupRun }[];
}

/** Ohne Backup seit zwei Tagen gilt der Stand als veraltet: Ein Backup am Tag, ein ausgefallener Lauf ist noch kein Grund */
export const BACKUP_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

const KINDS: BackupKind[] = ["backup", "restore_check"];

async function latest(kind: BackupKind, ok?: boolean): Promise<BackupRun | null> {
  const t = schema.backupStatus;
  const [row] = await db
    .select({ at: t.at, ok: t.ok, snapshot: t.snapshot, bytes: t.bytes, message: t.message })
    .from(t)
    .where(ok === undefined ? eq(t.kind, kind) : and(eq(t.kind, kind), eq(t.ok, ok)))
    .orderBy(desc(t.at), desc(t.id))
    .limit(1);
  return row ?? null;
}

export async function backupOverview(now = new Date()): Promise<BackupOverview> {
  const [lastBackup, lastCheck, ...lastRuns] = await Promise.all([
    latest("backup", true),
    latest("restore_check", true),
    ...KINDS.map((kind) => latest(kind)),
  ]);
  const failed = KINDS.flatMap((kind, i) => {
    const run = lastRuns[i];
    return run && !run.ok ? [{ kind, run }] : [];
  });
  const none = lastRuns.every((r) => !r);
  const overdue = !none && (!lastBackup || now.getTime() - lastBackup.at.getTime() > BACKUP_MAX_AGE_MS);
  const state: BackupOverview["state"] = none ? "keins" : failed.length > 0 ? "fehler" : overdue ? "veraltet" : "ok";
  return { state, overdue, lastBackup, lastCheck, failed };
}
