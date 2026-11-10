import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const journal = (folder: string) => JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));

/*
 * Migration 0192 (#542, Stichjahr für Voranmeldung und EÜR aus dem Journal) auf einer bestehenden Instanz: mit Buchungen
 * das Jahr nach dem Update in deutscher Zeit, ohne Buchungen leer; die Hash-Kette bleibt intakt (Fälle aus dem TDD-Review
 * von Pull Request #575).
 */
describe.skipIf(!testDatabaseUrl)("Migration 0192: Stichjahr auf einer bestehenden Instanz (Postgres)", () => {
  async function bis0191(): Promise<postgres.Sql> {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = journal(MIGRATIONS);
    const idx = full.entries.findIndex((e: { idx: number }) => e.idx === 192);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
    return sql;
  }

  it("setzt das Stichjahr bei Buchungen, Hash-Kette bleibt intakt", async () => {
    const sql = await bis0191();
    try {
      await sql`insert into company(id,name,versteuerung) values(1,'Testfirma','ist')`;
      await sql.begin(async (tx) => {
        const [e] =
          await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen) values('2026-03-01','x','manuell',gen_random_uuid(),'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1200', 100, 0), (${e!.id}, '8400', 0, 100)`;
        await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
      });
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      const [c] = await sql`select journal_ab from company`;
      const [y] = await sql`select extract(year from now() at time zone 'Europe/Berlin')::int + 1 as y`;
      expect(c!.journal_ab).toBe(y!.y);
      const problems = await sql`select * from haben_integrity_problems(100)`;
      expect(problems).toEqual([]);
      const [a] = await sql`select new_value from audit_log where table_name = 'company' order by seq desc limit 1`;
      expect((a!.new_value as { versteuerung: string }).versteuerung).toBe("ist");
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("lässt das Stichjahr ohne Buchungen leer", async () => {
    const sql = await bis0191();
    try {
      await sql`insert into company(id,name) values(1,'Testfirma')`;
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      const [c] = await sql`select journal_ab from company`;
      expect(c!.journal_ab).toBeNull();
    } finally {
      await sql.end();
    }
  }, 120_000);
});
