import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Anlagenart „Sonstige Transportmittel“ (Roadmap Platz 1, #312) mit Postgres: Zugang über einen Beleg, AfA nach der
 * Nutzungsdauer des Wirtschaftsguts, Verkauf (Abgang mit Restbuchwert, Erlös als Rechnung), EÜR und Anlage AVEÜR,
 * Abgleich. DATEV-Kontenrahmen 2026: SKR03 0380, SKR04 0560; AfA 4832/6222. SKR03 und SKR04, Ist und Soll.
 */

describe.skipIf(!testDatabaseUrl)("Sonstige Transportmittel (Postgres)", () => {
  let assets: typeof import("./assets.ts");
  let documents: typeof import("../belege/documents.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    assets = await import("./assets.ts");
    documents = await import("../belege/documents.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate asset_depreciations, assets, document_cancellations, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, journal_lines, journal_entries, document_splits, document_amounts, documents, vat_returns, year_closings, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland) values (1, 'Testfirma', ${versteuerung}, ${kontenrahmen}, 'BY')`;
  }

  /** Kauf eines Anhängers: 6.600 € netto + 19 %, privat bezahlt (Abfluss am Belegdatum) */
  async function kauf(method: "linear" | "elektro" = "linear") {
    fileSeq++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 3, 80]),
      filename: `anhaenger-${fileSeq}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Anhänger Center",
      supplierUstId: "",
      invoiceNumber: `AH-${fileSeq}`,
      documentDate: "2026-04-10",
      dueDate: null,
      category: "anlage",
      payment: "privat",
      note: "",
      reverseCharge: null,
      amounts: [{ taxRate: 1900, net: 6_600_00, tax: 1_254_00 }],
      // AfA-Tabelle für allgemein verwendbare Anlagegüter: Anhänger 11 Jahre
      asset: { name: "Kofferanhänger", kind: "transport", method, usefulLifeMonths: method === "linear" ? 132 : null },
    } as Parameters<typeof documents.updateDocument>[2]);
    return id;
  }

  const linesOf = async (sourceId: string) =>
    (
      await sql`select e.date::text as date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${sourceId} order by e.date, e.created_at, l.debit desc, l.credit desc`
    ).map((r) => ({ ...r }));

  it.each([
    ["SKR03", "ist", { anlage: "0380", afa: "4832", vorsteuer: "1576", einlage: "1890", restbuchwert: "2310" }],
    ["SKR04", "soll", { anlage: "0560", afa: "6222", vorsteuer: "1406", einlage: "2180", restbuchwert: "6895" }],
  ] as const)("%s, %s: Zugang, AfA nach Nutzungsdauer, Verkauf mit Restbuchwert", async (kr, versteuerung, k) => {
    await reset(kr, versteuerung);
    const id = await kauf();
    await documents.bookDocument(actor, id);
    expect(await linesOf(id)).toEqual([
      { date: "2026-04-10", account: k.anlage, debit: 6_600_00, credit: 0 },
      { date: "2026-04-10", account: k.vorsteuer, debit: 1_254_00, credit: 0 },
      { date: "2026-04-10", account: k.einlage, debit: 0, credit: 7_854_00 },
    ]);
    expect((await figures.computeVatFigures({ year: 2026, month: 4 })).kz66).toBe(1_254_00);

    // AfA 2026: April bis Dezember, 9 von 132 Monaten = 450 €
    const [asset] = (await assets.listAssets(2026)).filter((a) => a.documentId === id);
    expect(asset).toMatchObject({ kind: "transport", account: k.anlage, year: { depreciation: 450_00, closing: 6_150_00 } });
    await assets.bookDepreciation(actor, 2026, "2026-12-05");
    expect((await linesOf(asset!.id)).filter((l) => l.date === "2026-12-31")).toEqual([
      { date: "2026-12-31", account: k.afa, debit: 450_00, credit: 0 },
      { date: "2026-12-31", account: k.anlage, debit: 0, credit: 450_00 },
    ]);
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "afa")?.amount).toBe(450_00);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(1_254_00);
    // Anlage AVEÜR: bei den übrigen beweglichen Wirtschaftsgütern, nicht bei den Kfz
    const { anlagen } = await annual.euerYear(2026);
    expect(anlagen).toMatchObject([{ gruppe: "andere", bezeichnung: "Kofferanhänger", anschaffungskosten: 6_600_00, afa: 450_00 }]);
    expect(anlagen[0]).not.toHaveProperty("elektro");
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);

    // Verkauf Ende Juni 2027: AfA Januar bis Juni (300 €), Rest als Restbuchwert; der Erlös ist eine normale Rechnung
    await assets.updateAsset(actor, asset!.id, { name: "Kofferanhänger", disposalDate: "2027-06-30" });
    await assets.bookDepreciation(actor, 2027, "2028-01-10");
    expect((await linesOf(asset!.id)).filter((l) => l.date === "2027-06-30")).toEqual([
      { date: "2027-06-30", account: k.restbuchwert, debit: 5_850_00, credit: 0 },
      { date: "2027-06-30", account: k.afa, debit: 300_00, credit: 0 },
      { date: "2027-06-30", account: k.anlage, debit: 0, credit: 5_850_00 },
      { date: "2027-06-30", account: k.anlage, debit: 0, credit: 300_00 },
    ]);
    const euer2027 = await reports.euerForYear(2027);
    expect(euer2027.ausgaben.find((l) => l.key === "restbuchwert")?.amount).toBe(5_850_00);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2027)).zeilen)).toEqual([]);
  });

  it("ohne die Pkw-Regeln: keine Elektro-AfA, keine Privatnutzung nach der Listenpreismethode", async () => {
    await reset("SKR03", "ist");
    await expect(documents.bookDocument(actor, await kauf("elektro"))).rejects.toThrow("nur für Fahrzeuge");
    await expect(
      assets.createAsset(actor, {
        name: "Lastenrad",
        kind: "transport",
        method: "linear",
        acquisitionDate: "2025-05-02",
        cost: 4_000_00,
        usefulLifeMonths: 84,
        openingDate: "2026-01-01",
        openingBookValue: 3_000_00,
        disposalDate: null,
        note: "",
        privateUse: { listPrice: 4_000_00, drive: "elektro", rate: 25, vat: true },
      }),
    ).rejects.toThrow("nur für Fahrzeuge");
  });
});
