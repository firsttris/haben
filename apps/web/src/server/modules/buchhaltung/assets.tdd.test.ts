import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("TDD: Kfz-Privatnutzung bei Ausstieg aus § 19 im laufenden Jahr (Postgres)", () => {
  let assets: typeof import("./assets.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    assets = await import("./assets.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, company cascade`;
    // Kleinunternehmer seit dem Anlegen, heute (Monat > 1) ausgeschaltet: Jan. bis Vormonat § 19, Rest regulär
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, kleinunternehmer) values (1, 'Testfirma', 'ist', 'SKR03', 'BY', true)`;
  });

  it("Umsatzsteuer der Privatnutzung im Jahr (EÜR) = Summe der Monate der Voranmeldung", async () => {
    const year = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    expect(currentMonth).toBeGreaterThan(1);
    await sql`update company set kleinunternehmer = false`;
    await assets.createAsset(actor, {
      name: "VW Passat",
      kind: "kfz",
      method: "linear",
      acquisitionDate: `${year - 2}-01-10`,
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: `${year - 1}-01-01`,
      openingBookValue: 3_000_000,
      disposalDate: null,
      note: "",
      privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
    });

    let monthly = 0;
    for (let m = 1; m <= 12; m++) monthly += (await assets.privateUseForMonth(year, m)).reduce((s, r) => s + r.tax, 0);
    expect((await assets.withdrawalsForEuer(year)).ustEntnahmen).toBe(monthly);
  }, 60_000);
});
