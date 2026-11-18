import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/*
 * Migration 0289 (#1424) auf einer bestehenden Instanz: Der Abruf von App Store Connect stand nach dem letzten Lauf bei
 * fetch_from = 2026-11, geholt hatte er damit Apples Perioden bis 2026-10, also die Berichte bis Juli 2026. August bis
 * Oktober fehlen; der Abruf beginnt deshalb wieder im August. Google Play bleibt, wie es ist.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0289: Abruf von App Store Connect drei Monate zurück (Postgres)", () => {
  it("setzt fetch_from nur für den App Store zurück", async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const idx = full.entries.findIndex((e: { idx: number }) => e.idx === 289);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    try {
      await migrate(drizzle(sql), { migrationsFolder: previous });
      await sql`insert into store_connections (store, config, ciphertext, fetch_from) values
        ('appstore', '{"store":"appstore"}', '\\x00', '2026-11-01'), ('googleplay', '{"store":"googleplay"}', '\\x00', '2026-11-01')`;
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      expect(await sql`select store, to_char(fetch_from, 'YYYY-MM-DD') as fetch_from from store_connections order by store`).toEqual([
        { store: "appstore", fetch_from: "2026-08-01" },
        { store: "googleplay", fetch_from: "2026-11-01" },
      ]);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      await sql.end();
    }
  }, 120_000);
});
