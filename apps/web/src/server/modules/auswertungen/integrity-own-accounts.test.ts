import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kontenkollisionen in der Integritätsprüfung (Postgres, #787)", () => {
  let sql: postgres.Sql;
  let integrity: typeof import("./integrity.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    integrity = await import("./integrity.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate own_accounts cascade`;
  });

  it.each([
    { kontenrahmen: "SKR03", account: "4920", archived: false },
    { kontenrahmen: "SKR04", account: "6805", archived: true },
  ])("meldet das inzwischen reservierte $kontenrahmen-Konto $account (archiviert: $archived)", async ({ kontenrahmen, account, archived }) => {
    // Bestand nach einer Programmerweiterung: Die Nummer war beim Anlegen noch frei. Keine Trigger werden abgeschaltet.
    await sql`insert into own_accounts (kontenrahmen, account, name, parent_category, archived_at)
      values (${kontenrahmen}, ${account}, 'Eigene Software', 'software', ${archived ? new Date("2026-01-01") : null})`;
    const before = await sql`select * from own_accounts`;
    const head = await integrity.chainHead();

    const report = await integrity.checkIntegrity();

    expect(report.accountCollisions).toEqual([{ kontenrahmen, account, name: "Eigene Software" }]);
    // Eine Kontenkollision bedeutet weder Manipulation noch gebrochene Siegel. Die Prüfung schreibt nichts um.
    expect(report.problems).toEqual([]);
    expect(report.abgleich.abweichungen).toEqual([]);
    expect(await integrity.chainHead()).toEqual(head);
    expect(await sql`select * from own_accounts`).toEqual(before);
    expect(await sql`select id from journal_entries`).toEqual([]);
  });

  it("meldet keine freien eigenen Konten und auch keinen leeren Bestand als Kollision", async () => {
    expect((await integrity.checkIntegrity()).accountCollisions).toEqual([]);
    await sql`insert into own_accounts (kontenrahmen, account, name, parent_category)
      values ('SKR03', '4999', 'Software 03', 'software'), ('SKR04', '6999', 'Software 04', 'software')`;
    expect((await integrity.checkIntegrity()).accountCollisions).toEqual([]);
  });
});
