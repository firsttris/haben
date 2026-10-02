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

  it("Elektroauto mit 0,25 %: Entnahme in EÜR, Umsatzsteuer vom vollen Listenpreis in der Voranmeldung, Buchung je Monat", async () => {
    const figures = await import("./vat-figures.ts");
    const car = await assets.createAsset(actor, {
      ...takeover,
      name: "Tesla Model Y",
      privateUse: { listPrice: 5_890_000, drive: "elektro", rate: 25, vat: true },
    });
    const october = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(october.revenue.filter((r) => r.type === "entnahme")).toEqual([
      expect.objectContaining({ assetId: car.id, base: 47_120, tax: 8_953, rate: 1900 }),
    ]);
    expect(october).toMatchObject({ kz81: 47_120, tax81: 8_953 });

    const euer = await reports.euerForYear(2026);
    const amount = (key: string) => euer.einnahmen.find((l) => l.key === key)?.amount ?? 0;
    expect(amount("privateKfz")).toBe(12 * 14_725);
    expect(amount("ustEntnahmen")).toBe(12 * 8_953);

    await assets.bookDepreciation(actor, 2026, "2026-12-05");
    const [sums] = await sql`select count(*)::int as entries, sum(l.credit) filter (where l.account = '1776')::int as vat
      from journal_entries e join journal_lines l on l.entry_id = e.id where e.source_id = ${car.id} and e.description like 'Privatnutzung%'`;
    expect(sums).toMatchObject({ vat: 12 * 8_953 });
    const [row] = await sql`select private_use, private_use_vat from asset_depreciations where asset_id = ${car.id}`;
    expect(row).toMatchObject({ private_use: 12 * 14_725, private_use_vat: 12 * 8_953 });
    await expect(
      assets.updateAsset(actor, car.id, { name: "Tesla", privateUse: { listPrice: 5_000_000, drive: "elektro", rate: 25, vat: true } }),
    ).rejects.toThrow("Privatnutzung");
  });

  it("Privatnutzung nur bei Fahrzeugen, Kleinunternehmer ohne Umsatzsteuer", async () => {
    await expect(
      assets.createAsset(actor, { ...takeover, kind: "buero", privateUse: { listPrice: 100_000, drive: "elektro", rate: 25, vat: true } }),
    ).rejects.toThrow("nur für Fahrzeuge");
    await sql`update company set kleinunternehmer = true`;
    const car = await assets.createAsset(actor, { ...takeover, privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true } });
    expect(car.privateUse?.vat).toBe(false);
  });

  it("Beleg mit Privatanteil: nur der betriebliche Teil zählt als Vorsteuer und Ausgabe", async () => {
    const figures = await import("./vat-figures.ts");
    await sql`update company set private_shares = '{"telefon": 20}'::jsonb`;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]), filename: "telekom.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Telekom", supplierUstId: "", invoiceNumber: "T-1", documentDate: "2026-10-05", dueDate: null,
      category: "telefon", payment: "privat", note: "", privateShare: 20, amounts: [{ taxRate: 1900, net: 4_000, tax: 760 }],
    });
    await documents.bookDocument(actor, id);
    expect(await linesOf(id)).toEqual([
      { date: "2026-10-05", account: "4920", debit: 3_200, credit: 0 },
      { date: "2026-10-05", account: "1800", debit: 952, credit: 0 },
      { date: "2026-10-05", account: "1576", debit: 608, credit: 0 },
      { date: "2026-10-05", account: "1890", debit: 0, credit: 4_760 },
    ]);
    expect((await figures.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(608);
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:telefon")?.amount).toBe(3_200);
  });
});
