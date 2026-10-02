import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Anlagenverzeichnis (Postgres)", () => {
  let assets: typeof import("./assets.ts");
  let documents: typeof import("./documents.ts");
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    assets = await import("./assets.ts");
    documents = await import("./documents.ts");
    reports = await import("./reports.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland) values (1, 'Testfirma', 'ist', 'SKR03', 'BY')`;
  });

  const takeover = {
    name: "VW Passat",
    kind: "kfz" as const,
    method: "linear" as const,
    acquisitionDate: "2024-01-10",
    cost: 3_600_000,
    usefulLifeMonths: 72,
    openingDate: "2026-01-01",
    openingBookValue: 2_400_000,
    disposalDate: null,
    note: "",
  };

  const linesOf = async (sourceId: string) =>
    (await sql`select e.date::text as date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${sourceId} order by e.date, e.created_at, l.debit desc, l.credit desc`).map((r) => ({ ...r }));

  it("Beleg mit Kategorie Anlagegut: Anlagekonto statt Aufwand, AfA in der EÜR", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7]), filename: "auto.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Autohaus", supplierUstId: "", invoiceNumber: "A-1", documentDate: "2026-03-15", dueDate: null,
      category: "anlage", payment: "privat", note: "", amounts: [{ taxRate: 1900, net: 3_600_000, tax: 684_000 }],
      asset: { name: "Tesla Model 3", kind: "kfz", method: "linear", usefulLifeMonths: 72 },
    });
    await documents.bookDocument(actor, id);
    expect(await linesOf(id)).toEqual([
      { date: "2026-03-15", account: "0320", debit: 3_600_000, credit: 0 },
      { date: "2026-03-15", account: "1576", debit: 684_000, credit: 0 },
      { date: "2026-03-15", account: "1890", debit: 0, credit: 4_284_000 },
    ]);
    const [asset] = (await assets.listAssets(2026)).filter((a) => a.documentId === id);
    expect(asset).toMatchObject({ name: "Tesla Model 3", account: "0320", cost: 3_600_000, year: { depreciation: 500_000, closing: 3_100_000 } });

    const euer = await reports.euerForYear(2026);
    const amount = (key: string) => euer.ausgaben.find((l) => l.key === key)?.amount ?? 0;
    expect(amount("afa")).toBe(500_000);
    expect(amount("vorsteuer")).toBe(684_000);
    expect(amount("ausgabe:anlage")).toBe(0);
  });

  it("Beleg als Anlage braucht die Angaben zur Anlage", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 8]), filename: "x.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Händler", supplierUstId: "", invoiceNumber: "", documentDate: "2026-03-15", dueDate: null,
      category: "anlage", payment: "bank", note: "", amounts: [{ taxRate: 1900, net: 90_000, tax: 17_100 }],
      asset: { name: "Monitor", kind: "edv", method: "gwg", usefulLifeMonths: null },
    });
    await expect(documents.bookDocument(actor, id)).rejects.toThrow("bis 800 €");
  });

  it("Übernahme: Eröffnung und AfA beim Buchen, danach gesperrt", async () => {
    const asset = await assets.createAsset(actor, takeover);
    await expect(assets.bookDepreciation(actor, 2026, "2026-10-02")).rejects.toThrow("ab dem 1. Dezember");
    expect(await assets.bookDepreciation(actor, 2026, "2026-12-05")).toEqual({ booked: 1 });
    expect(await linesOf(asset.id)).toEqual([
      { date: "2026-01-01", account: "0320", debit: 2_400_000, credit: 0 },
      { date: "2026-01-01", account: "9000", debit: 0, credit: 2_400_000 },
      { date: "2026-12-31", account: "4832", debit: 600_000, credit: 0 },
      { date: "2026-12-31", account: "0320", debit: 0, credit: 600_000 },
    ]);
    await expect(assets.bookDepreciation(actor, 2026, "2026-12-05")).rejects.toThrow("keine AfA");
    await expect(sql`update assets set cost = 1 where id = ${asset.id}`).rejects.toThrow("unveränderlich");
    await expect(assets.deleteAsset(actor, asset.id)).rejects.toThrow("nicht mehr gelöscht");
    await expect(assets.updateAsset(actor, asset.id, { name: "VW Passat", disposalDate: "2026-06-30" })).rejects.toThrow("schon gebucht");

    // Verkauf 2027: AfA bis März, Rest als Restbuchwert
    await assets.updateAsset(actor, asset.id, { name: "VW Passat Kombi", disposalDate: "2027-03-31" });
    await assets.bookDepreciation(actor, 2027, "2028-01-10");
    const lines = await linesOf(asset.id);
    expect(lines.slice(4)).toEqual([
      { date: "2027-03-31", account: "2310", debit: 1_650_000, credit: 0 },
      { date: "2027-03-31", account: "4832", debit: 150_000, credit: 0 },
      { date: "2027-03-31", account: "0320", debit: 0, credit: 1_650_000 },
      { date: "2027-03-31", account: "0320", debit: 0, credit: 150_000 },
    ]);
    const euer = await reports.euerForYear(2027);
    expect(euer.ausgaben.find((l) => l.key === "restbuchwert")?.amount).toBe(1_650_000);
  });

  it("frühere Jahre zuerst buchen", async () => {
    await assets.createAsset(actor, { ...takeover, openingDate: "2025-01-01", openingBookValue: 3_000_000 });
    await expect(assets.bookDepreciation(actor, 2026, "2026-12-05")).rejects.toThrow("früherer Jahre");
  });

  it("nicht gebuchte Übernahme lässt sich ändern und löschen", async () => {
    const asset = await assets.createAsset(actor, takeover);
    const updated = await assets.updateAsset(actor, asset.id, { name: "Passat", openingBookValue: 2_300_000 });
    expect(updated.openingBookValue).toBe(2_300_000);
    await assets.deleteAsset(actor, asset.id);
    expect(await assets.listAssets(2026)).toEqual([]);
  });
});
