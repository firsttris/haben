import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Akzentfarbe (Postgres)", () => {
  let letterhead: typeof import("./letterhead.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    letterhead = await import("./letterhead.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate company_logo, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("gilt ohne Einstellung das Standardgrün, ohne Logo", async () => {
    expect(await letterhead.loadLetterhead()).toEqual({ accent: "#1F6F5C" });
  });

  it("speichert die Farbe groß geschrieben und protokolliert sie", async () => {
    await letterhead.saveAccentColor(actor, "#0055aa");
    expect((await letterhead.loadLetterhead()).accent).toBe("#0055AA");
    const [log] = await sql`select new_value from audit_log where table_name = 'company' and action = 'UPDATE' order by seq desc limit 1`;
    expect(log!.new_value).toMatchObject({ accent_color: "#0055AA" });
  });

  it("lehnt alles außer #RRGGBB ab, auch direkt in der Datenbank", async () => {
    for (const color of ["blue", "#05A", "#0055AAFF", "0055AA", '#00"); panic('])
      await expect(letterhead.saveAccentColor(actor, color)).rejects.toThrow(/#RRGGBB/);
    await expect(sql`update company set accent_color = 'rot' where id = 1`).rejects.toThrow(/company_accent_color/);
  });
});
