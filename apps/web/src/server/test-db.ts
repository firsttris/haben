import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
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
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), "haben-belege-")),
  });
  await recreateDatabase(baseUrl!, databaseName(testDatabaseUrl!), templateName(baseUrl!));
  const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
  // Drizzle stellt den Client beim Einbinden um (Datum und Zeit als Text, JSON unverändert schreiben);
  // die Tests sind darauf geschrieben, wie für den Client der App
  const { drizzle } = await import("drizzle-orm/postgres-js");
  drizzle(sql);
  return sql;
}

/** globalSetup von Vitest: migriert einmal je Lauf die Vorlage; ohne TEST_DATABASE_URL nichts zu tun */
export async function setup(): Promise<void> {
  if (!baseUrl) return;
  const template = templateName(baseUrl);
  await recreateDatabase(baseUrl, template);
  await migrateTestDb(withDatabase(baseUrl, template));
}
