import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Review: Anlagen und Kleinunternehmer (Postgres)", () => {
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
    // Kleinunternehmer vom ersten Protokolleintrag an: gilt für alle Monate, unabhängig vom heutigen Datum
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, kleinunternehmer) values (1, 'Testfirma', 'ist', 'SKR03', 'BY', true)`;
  });

  it("Privatnutzung eines Fahrzeugs: nach dem Wechsel zum Kleinunternehmer keine Umsatzsteuer mehr darauf", async () => {
    const car = await assets.createAsset(actor, {
      name: "VW Passat",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2024-01-10",
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 3_000_000,
      disposalDate: null,
      note: "",
      privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
    });
    // Das Fahrzeug steht noch mit Umsatzsteuer auf der Privatnutzung drin, wie vor einem Wechsel zu § 19 UStG angelegt
    await sql`update assets set private_use = jsonb_set(private_use, '{vat}', 'true') where id = ${car.id}`;
    await assets.bookDepreciation(actor, 2025, "2025-12-05");

    // Als Kleinunternehmer schuldet man keine Umsatzsteuer auf die unentgeltliche Wertabgabe
    expect.soft((await assets.withdrawalsForEuer(2026)).ustEntnahmen).toBe(0);
    expect.soft(await assets.privateUseForMonth(2026, 10)).toEqual([]);
    await assets.bookDepreciation(actor, 2026, "2026-12-05");
    const [booked] = await sql`select coalesce(sum(l.credit) filter (where l.account = '1776'), 0)::int as vat
      from journal_entries e join journal_lines l on l.entry_id = e.id where e.source_id = ${car.id} and e.date >= '2026-01-01'`;
    expect(booked!.vat).toBe(0);
  }, 60_000);
});
