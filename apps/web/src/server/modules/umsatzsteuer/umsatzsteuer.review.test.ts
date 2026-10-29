import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Review: berichtigte Voranmeldung (Postgres)", () => {
  let vat: typeof import("./vat.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const period = { year: 2026, month: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./vat.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, company`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY')`;
  });

  it("zweite Berichtigung, solange schon eine als Entwurf offen ist: verständliche Meldung statt internem Fehler", async () => {
    await sql`insert into vat_returns (year, month, kz81, status, sent_at, locked_at) values (2026, 10, 100000, 'sent', now(), now())`;
    await vat.createCorrection(actor, period);
    await expect(vat.createCorrection(actor, period)).rejects.toBeInstanceOf(vat.VatError);
  }, 30_000);
});
