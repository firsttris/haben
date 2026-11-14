import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Eingesetzte Versionen abfragen (#841)", () => {
  let sql: postgres.Sql;
  let versionen: typeof import("./index.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    versionen = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("liefert den Versionsverlauf absteigend und filtert fürs Jahresarchiv inklusive fortlaufender Vorjahresversion", async () => {
    await sql`
      insert into app_versions (version, postgres_version, started_at, note) values
        ('0.7.0', '18.5', '2025-02-01T10:00:00Z', 'Versionsverlauf ab diesem Start aufgezeichnet; für die Zeit davor liegt keine Aufzeichnung vor.'),
        ('0.8.0', '18.5', '2025-11-15T08:00:00Z', null),
        ('0.8.2', '18.6', '2026-04-10T12:00:00Z', null),
        ('0.8.1', '18.6', '2026-05-01T09:30:00Z', null)
    `;

    const all = await versionen.listAppVersions();
    expect(all.map((entry) => entry.version)).toEqual(["0.8.1", "0.8.2", "0.8.0", "0.7.0"]);
    expect(all[3]?.note).toContain("keine Aufzeichnung");

    // 2024: noch keine Aufzeichnung gestartet
    expect(await versionen.appVersionsForYear(2024)).toEqual([]);

    // 2025: 0.7.0 und 0.8.0
    expect((await versionen.appVersionsForYear(2025)).map((entry) => entry.version)).toEqual(["0.7.0", "0.8.0"]);

    // 2026: 0.8.0 lief ins Jahr 2026 hinein, danach 0.8.2 und Rollback auf 0.8.1
    expect((await versionen.appVersionsForYear(2026)).map((entry) => entry.version)).toEqual(["0.8.0", "0.8.2", "0.8.1"]);

    // 2027: nur noch die zuletzt aktive Version 0.8.1
    expect((await versionen.appVersionsForYear(2027)).map((entry) => entry.version)).toEqual(["0.8.1"]);
  });
});
