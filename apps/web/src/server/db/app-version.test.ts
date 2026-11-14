import type postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { VERSION_HISTORY_GENESIS_NOTE, readAppVersion, recordAppVersion } from "./app-version.ts";

describe.skipIf(!testDatabaseUrl)("Versionsverlauf in app_versions (#841)", () => {
  let sql: postgres.Sql;

  beforeEach(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("liest die aktuelle Paketversion und schreibt beim Erststart genau einen Eintrag mit Audit-Log", async () => {
    const pkgVersion = readAppVersion();
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+/);

    expect(await recordAppVersion(sql, "0.8.2")).toBe(true);

    const rows = await sql`
      select id, version, postgres_version, started_at, note from app_versions order by id asc
    `;
    expect(rows).toHaveLength(1);
    const [server] = await sql`select current_setting('server_version') as version`;
    expect(rows[0]).toMatchObject({
      version: "0.8.2",
      postgres_version: server?.version,
      note: null,
    });
    expect(Number.isNaN(Date.parse(String(rows[0]?.started_at)))).toBe(false);

    const audits = await sql`
      select actor, table_name, action, row_id
      from audit_log
      where table_name = 'app_versions'
      order by seq asc
    `;
    expect(audits).toEqual([{ actor: "system:migration", table_name: "app_versions", action: "INSERT", row_id: String(rows[0]?.id) }]);
    expect(await sql`select * from haben_integrity_problems()`).toEqual([]);
  });

  it("schreibt beim Neustart mit derselben Version nichts, wohl aber bei Update und Zurückrollen", async () => {
    expect(await recordAppVersion(sql, "0.8.2")).toBe(true);
    expect(await recordAppVersion(sql, "0.8.2")).toBe(false);

    expect(await recordAppVersion(sql, "0.9.0")).toBe(true);
    expect(await recordAppVersion(sql, "0.9.0")).toBe(false);

    // Zurückrollen auf eine ältere Version hängt einen neuen Eintrag an.
    expect(await recordAppVersion(sql, "0.8.2")).toBe(true);

    const rows = await sql`select version, note from app_versions order by id asc`;
    expect(rows).toEqual([
      { version: "0.8.2", note: null },
      { version: "0.9.0", note: null },
      { version: "0.8.2", note: null },
    ]);
    expect(await sql`select * from haben_integrity_problems()`).toEqual([]);
  });

  it("vermerkt auf Bestandsinstanzen ab dem ersten Eintrag das Fehlen früherer Aufzeichnungen", async () => {
    await sql`
      insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
      values ('u-bestand', 'Test', 'bestand@example.de', true, 'inhaber', now(), now())
    `;

    expect(await recordAppVersion(sql, "0.8.2")).toBe(true);
    expect(await recordAppVersion(sql, "0.8.3")).toBe(true);

    const rows = await sql`select version, note from app_versions order by id asc`;
    expect(rows).toEqual([
      { version: "0.8.2", note: VERSION_HISTORY_GENESIS_NOTE },
      { version: "0.8.3", note: null },
    ]);
  });

  it("lehnt UPDATE, DELETE und TRUNCATE auf app_versions ab", async () => {
    await recordAppVersion(sql, "0.8.2");
    await expect(sql`update app_versions set version = '9.9.9'`).rejects.toThrow();
    await expect(sql`delete from app_versions`).rejects.toThrow();
    await expect(sql`truncate table app_versions`).rejects.toThrow();
    await expect(sql`truncate table app_versions cascade`).rejects.toThrow();
  });
});
