import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  // drizzle-kit vergleicht das Schema mit dem letzten Snapshot: Fehlt einer, erzeugt der nächste `db:generate` die
  // Änderung noch einmal (etwa ein zweites ADD VALUE, das beim Update scheitert). Snapshots schreibt nur drizzle-kit.
  it("hat zu jeder Migration einen Snapshot von drizzle-kit", () => {
    const { entries } = journal(MIGRATIONS);
    const ohne = entries.filter((e) => !existsSync(join(MIGRATIONS, "meta", `${String(e.idx).padStart(4, "0")}_snapshot.json`))).map((e) => e.tag);
    expect(ohne).toEqual([]);
  });

  // drizzle-kit setzt „when“ auf die Zeit der Erzeugung. Ein Zeitstempel in der Zukunft (von Hand geschrieben) ließe die
  // nächste erzeugte Migration älter aussehen; auf Installationen mit der falschen würde sie übersprungen.
  it("hat keinen Zeitstempel in der Zukunft", () => {
    const { entries } = journal(MIGRATIONS);
    expect(entries.filter((e) => e.when > Date.now()).map((e) => e.tag)).toEqual([]);
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
  async function migrateWithExistingTokens(owners: string[]) {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await admin`drop database if exists ${admin(name)} with (force)`;
      await admin`create database ${admin(name)}`;
    } finally {
      await admin.end();
    }
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = journal(MIGRATIONS);
    const tokenMigration = full.entries.findIndex((entry) => entry.idx === 186);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, tokenMigration) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
    for (const id of owners) await sql`insert into "user"(id,name,email,role) values(${id},${id},${`${id}@example.de`},'inhaber')`;
    await sql`insert into mcp_tokens(name,token_hash,prefix,scopes,expires_at) values('Alt','hash','hb_x',${["haben:lesen"]},now()+interval '30 days')`;
    await sql`insert into company(id,name,calendar_token_hash) values(1,'Testfirma',repeat('a',64))`;
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    return sql;
  }

  it("ordnet bestehende Tokens dem einzigen Inhaber zu und lässt sie aktiv", async () => {
    const sql = await migrateWithExistingTokens(["einzig"]);
    try {
      expect((await sql`select created_by,responsible_id,disabled_at from mcp_tokens`)[0]).toMatchObject({
        created_by: "einzig",
        responsible_id: "einzig",
        disabled_at: null,
      });
      expect((await sql`select calendar_token_created_by,calendar_token_responsible_id,calendar_token_disabled_at from company`)[0]).toMatchObject({
        calendar_token_created_by: "einzig",
        calendar_token_responsible_id: "einzig",
        calendar_token_disabled_at: null,
      });
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("erfindet ohne Inhaber keinen Verantwortlichen und deaktiviert", async () => {
    const sql = await migrateWithExistingTokens([]);
    try {
      expect((await sql`select responsible_id,disabled_reason from mcp_tokens`)[0]).toMatchObject({
        responsible_id: null,
        disabled_reason: "verantwortung-unbekannt",
      });
      expect((await sql`select calendar_token_responsible_id,calendar_token_disabled_reason from company`)[0]).toMatchObject({
        calendar_token_responsible_id: null,
        calendar_token_disabled_reason: "verantwortung-unbekannt",
      });
    } finally {
      await sql.end();
    }
  }, 120_000);
});
