import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Gemeinsamer Import: globale Belegregeln (Postgres)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it("behält die globalen eindeutigen Belegnummern unabhängig vom Importweg", async () => {
    const rows = await sql`select conname from pg_constraint where conname in ('invoices_number_unique','quotes_number_unique') order by conname`;
    expect(rows.map((r) => r.conname)).toEqual(["invoices_number_unique", "quotes_number_unique"]);
  });

  it("macht die Gültigkeit neuer nativer Angebote nicht optional", async () => {
    const [row] = await sql`select attnotnull from pg_attribute where attrelid='quotes'::regclass and attname='valid_until'`;
    expect(row!.attnotnull).toBe(true);
  });
});
