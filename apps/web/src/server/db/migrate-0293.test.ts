import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/*
 * Migration 0293 (#1424) auf einer bestehenden Instanz: Der Abruf von App Store Connect stand nach dem letzten Lauf bei
 * fetch_from = 2026-11, geholt hatte er damit Apples Perioden bis 2026-10, also die Berichte bis Juli 2026. August bis
 * Oktober fehlen; der Abruf beginnt deshalb wieder im August. Google Play bleibt, wie es ist.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0293: Abruf von App Store Connect drei Monate zurück (Postgres)", () => {
  /** Instanz auf dem Stand vor 0293 mit beiden Zugängen bei fetch_from = 2026-11, danach die Migration */
  async function migriert(vorher: (sql: postgres.Sql) => Promise<void>) {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const idx = full.entries.findIndex((e: { idx: number }) => e.idx === 293);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    try {
      await migrate(drizzle(sql), { migrationsFolder: previous });
      await sql`insert into store_connections (store, config, ciphertext, fetch_from) values
        ('appstore', '{"store":"appstore"}', '\\x00', '2026-11-01'), ('googleplay', '{"store":"googleplay"}', '\\x00', '2026-11-01')`;
      await vorher(sql);
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      const rows = await sql`select store, to_char(fetch_from, 'YYYY-MM-DD') as fetch_from from store_connections order by store`;
      return Object.fromEntries(rows.map((r) => [r.store, r.fetch_from]));
    } finally {
      await sql.end();
    }
  }

  const bericht = async (sql: postgres.Sql, store: string, kind: string) => {
    const [file] = await sql`insert into archive_files (kind, year, filename, mime_type, size, sha256)
      values ('storebericht', 2026, 'bericht.gz', 'application/gzip', 1, ${"0".repeat(64)}) returning id`;
    await sql`insert into store_reports (store, report_kind, part, period, sha256, archive_file_id)
      values (${store}, ${kind}, 'Z1', '2026-10', ${"0".repeat(64)}, ${file!.id})`;
  };

  /** Letzter Abruf des App Store nach dem letzten Speichern des Zugangs (`nach`) oder davor */
  const abruf = (sql: postgres.Sql, wann: "nach" | "vor") =>
    sql`update store_connections set last_sync_at = updated_at + ${wann === "nach" ? "1 hour" : "-1 hour"}::interval where store = 'appstore'`;

  it("setzt fetch_from zurück, wenn Berichte des App Store im Archiv liegen und seit dem Speichern ein Abruf lief; Google Play bleibt", async () => {
    const stand = await migriert(async (sql) => {
      await bericht(sql, "appstore", "finance_detail");
      await abruf(sql, "nach");
    });
    expect(stand).toEqual({ appstore: "2026-08-01", googleplay: "2026-11-01" });
  }, 120_000);

  it("lässt einen Zugang ohne archivierten Bericht des App Store beim gewählten Monat", async () => {
    // Kein Abruf hat je einen Bericht geholt: keine Lücke, sonst kämen drei Monate vor dem gewählten Beginn ins Konto
    const stand = await migriert(async (sql) => {
      await bericht(sql, "googleplay", "earnings");
      await abruf(sql, "nach");
    });
    expect(stand).toEqual({ appstore: "2026-11-01", googleplay: "2026-11-01" });
  }, 120_000);

  it("lässt einen Monat, der nach dem letzten Abruf neu gewählt wurde, auch mit altem Bericht im Archiv", async () => {
    // Alter Bericht im Archiv, danach „Berichte ab Monat“ neu gespeichert (updated_at nach last_sync_at), etwa nach dem
    // Löschen und erneuten Anlegen des Zugangs: Der Bericht belegt keine Lücke zu diesem Monat (Review zu #1444)
    const stand = await migriert(async (sql) => {
      await bericht(sql, "appstore", "finance_detail");
      await abruf(sql, "vor");
    });
    expect(stand).toEqual({ appstore: "2026-11-01", googleplay: "2026-11-01" });
  }, 120_000);
});
