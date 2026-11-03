import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

const journal = (folder: string): Journal => JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));

/*
 * Drizzle wendet beim Update nur Migrationen an, deren Zeitstempel „when“ im Journal nach dem der zuletzt angewendeten
 * liegt (drizzle-orm, pg-core/dialect.js: lastDbMigration.created_at < migration.folderMillis). Eine neue Migration
 * mit älterem Zeitstempel würde auf bestehenden Installationen stillschweigend übersprungen.
 */
describe("Migrationsjournal", () => {
  it("hat streng steigende Zeitstempel", () => {
    const { entries } = journal(MIGRATIONS);
    const behind = entries.filter((e, i) => i > 0 && e.when <= entries[i - 1]!.when).map((e) => e.tag);
    expect(behind).toEqual([]);
  });
});

describe.skipIf(!testDatabaseUrl)("Update einer bestehenden Installation (Postgres)", () => {
  it("wendet die neueste Migration auch auf eine Datenbank mit allen älteren an", async () => {
    // Die Datenbank dieses Workers wird leer neu angelegt, wie bei setupTestDb nur ohne Vorlage
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await admin`drop database if exists ${admin(name)} with (force)`;
      await admin`create database ${admin(name)}`;
    } finally {
      await admin.end();
    }

    // Stand der Vorversion: dieselben Migrationen ohne die letzte
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = journal(MIGRATIONS);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, -1) }));

    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(drizzle(sql), { migrationsFolder: previous });
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(row?.count).toBe(full.entries.length);
    } finally {
      await sql.end();
    }
  }, 120_000);
});
