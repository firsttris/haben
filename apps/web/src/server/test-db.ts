import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/*
 * Integrationstests laufen nur mit TEST_DATABASE_URL. Die Datenbank dort dient nur als Einstieg: Daneben legen die
 * Tests <name>_vorlage (einmal je Lauf migriert, `setup` als globalSetup) und je Vitest-Worker <name>_<Nummer> an,
 * damit die Testdateien parallel laufen. Alle werden dabei gelöscht und neu angelegt.
 */
const baseUrl = process.env.TEST_DATABASE_URL;

/** Dieselbe Verbindung mit einer anderen Datenbank */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** Name der migrierten Vorlage, aus der jede Testdatei ihre Datenbank klont */
function templateName(url: string): string {
  return `${databaseName(url)}_vorlage`;
}

/** Die Datenbank dieses Workers (VITEST_POOL_ID: 1 bis maxWorkers); ohne TEST_DATABASE_URL undefined */
export const testDatabaseUrl = baseUrl && withDatabase(baseUrl, `${databaseName(baseUrl)}_${process.env.VITEST_POOL_ID ?? "1"}`);

/*
 * Temp-Ordner der Tests: `setup` legt je Lauf $TMPDIR/haben-test-<PID>-… an und setzt TMPDIR, TMP und TEMP darauf. Worker und ihre
 * Kindprozesse erben das, jedes `tmpdir()` zeigt also in den Ordner des Laufs, den `setup` am Ende löscht. Bricht ein
 * Lauf ab, ohne aufzuräumen, löscht der nächste Lauf dessen Ordner, sobald der Prozess nicht mehr lebt.
 */
const RUN_PREFIX = "haben-test-";

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Löscht Ordner abgebrochener Läufe, deren Prozess nicht mehr läuft; Ordner laufender Läufe bleiben */
export function removeAbandonedRunDirs(base = tmpdir()): void {
  for (const name of readdirSync(base)) {
    const pid = Number(new RegExp(`^${RUN_PREFIX}(\\d+)-`).exec(name)?.[1]);
    if (pid && pid !== process.pid && !processAlive(pid)) rmSync(join(base, name), { recursive: true, force: true });
  }
}

/** Legt den Temp-Ordner eines Laufs unter `base` an, nach dem Aufräumen abgebrochener Läufe; `remove` löscht ihn samt Inhalt */
export function createRunDir(base = tmpdir()): { root: string; remove: () => void } {
  removeAbandonedRunDirs(base);
  const root = mkdtempSync(join(base, `${RUN_PREFIX}${process.pid}-`));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** TMPDIR, TMP und TEMP zeigen auf `dir` (Windows liest TEMP und TMP); die Rückgabe stellt die alten Werte wieder her */
export function redirectTempDirs(dir: string): () => void {
  const names = ["TMPDIR", "TMP", "TEMP"] as const;
  const before = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = dir;
  return () =>
    names.forEach((name, i) => {
      if (before[i] === undefined) delete process.env[name];
      else process.env[name] = before[i];
    });
}

/**
 * Belegordner des Workers: je Worker einer, beim nächsten Aufruf geleert. Ein Ordner je Testdatei sammelte sich sonst
 * bis zum Ende des Laufs an.
 */
export function workerDocumentsDir(): string {
  const dir = join(tmpdir(), `haben-belege-${process.env.VITEST_POOL_ID ?? "1"}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Wendet alle Migrationen auf die Datenbank hinter `url` an */
async function migrateTestDb(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  } finally {
    await sql.end();
  }
}

/** Legt `database` neu an, als Kopie von `template` (ohne Vorlage leer); bestehende Verbindungen dorthin werden getrennt */
async function recreateDatabase(url: string, database: string, template?: string): Promise<void> {
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin`drop database if exists ${admin(database)} with (force)`;
    // Ab PostgreSQL 15 (Strategie WAL_LOG) kopiert das eine kleine Vorlage in rund 0,1 s; Migrationen bräuchten 0,6 s
    if (template) await admin`create database ${admin(database)} template ${admin(template)}`;
    else await admin`create database ${admin(database)}`;
  } finally {
    await admin.end();
  }
}

/** Setzt die Umgebung und legt die Datenbank des Workers frisch aus der Vorlage an. */
export async function setupTestDb(): Promise<postgres.Sql> {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl,
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    DOCUMENTS_DIR: workerDocumentsDir(),
  });
  await recreateDatabase(baseUrl!, databaseName(testDatabaseUrl!), templateName(baseUrl!));
  const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
  // Drizzle stellt den Client beim Einbinden um (Datum und Zeit als Text, JSON unverändert schreiben);
  // die Tests sind darauf geschrieben, wie für den Client der App
  const { drizzle } = await import("drizzle-orm/postgres-js");
  drizzle(sql);
  return sql;
}

/**
 * Leert Tabellen zwischen zwei Testfällen: `await leeren(sql)\`truncate … cascade\``. Auf festgeschriebenen und nur
 * anhängbaren Tabellen lehnen Trigger TRUNCATE ab (0201). Die Tests schalten dafür nur in dieser einen Transaktion die
 * Trigger ab, wie ein Replikat (`session_replication_role`, braucht einen Superuser wie den aus compose.yml und der CI);
 * die Sperren selbst bleiben unverändert. Nur für TRUNCATE, damit kein anderer Trigger nebenbei umgangen wird.
 */
export function leeren(sql: postgres.Sql) {
  return async (strings: TemplateStringsArray, ...values: never[]): Promise<void> => {
    if (!/^\s*truncate\s/i.test(strings[0] ?? "")) throw new Error("leeren ist nur für TRUNCATE gedacht");
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx(strings, ...values);
    });
  };
}

/**
 * globalSetup von Vitest: legt den Temp-Ordner des Laufs an und lenkt TMPDIR, TMP und TEMP dorthin (die Worker erben das),
 * dann migriert es mit TEST_DATABASE_URL einmal je Lauf die Vorlage. Die zurückgegebene Funktion löscht den Temp-Ordner
 * am Ende des Laufs.
 */
export async function setup(): Promise<() => void> {
  const { root, remove } = createRunDir();
  const restore = redirectTempDirs(root);
  // Vitest ruft im Watch-Modus nach einer Änderung der Konfiguration erst teardown, dann wieder setup im selben Prozess
  const teardown = () => {
    restore();
    remove();
  };
  if (!baseUrl) return teardown;
  try {
    const template = templateName(baseUrl);
    await recreateDatabase(baseUrl, template);
    await migrateTestDb(withDatabase(baseUrl, template));
  } catch (error) {
    teardown();
    throw error;
  }
  return teardown;
}
