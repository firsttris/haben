import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Umsatzsteuer-Verprobung (#1230) über echte Buchungswege: Teilabzug der Vorsteuer (§ 15 Abs. 4 UStG) neben Positionen zu
// 0 % bleibt ohne Hinweis. Erfundene Belege.
describe.skipIf(!testDatabaseUrl)("Verprobung bei Teilabzug (Postgres, #1230)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/index.ts");
  let verprobung: typeof import("./abgleich-verprobung.ts");
  const actor = "verprobung-teilabzug-test";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/index.ts");
    verprobung = await import("./abgleich-verprobung.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, asset_depreciations, assets,
      journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Testweg 1', '93047', 'Regensburg', 'test@example.com', '198/113/10010', 'BY', 'soll', ${kr})`;
  }

  type Amount = { taxRate: 1900 | 700 | 0; net: number; tax: number; vorsteuerAnteil?: number | null };
  type Split = { category: "software" | "buero"; taxRate: 1900 | 700 | 0; net: number };
  async function buche(options: { amounts: Amount[]; splits?: Split[]; privateShare?: number; reverseCharge?: "eu" }) {
    seq++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, seq % 256, 91]),
      filename: `verprobung-${seq}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant GmbH",
      supplierUstId: "",
      invoiceNumber: `V-${seq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: options.splits ? "sonstiges" : "buero",
      payment: "bank",
      note: "",
      vorsteuerAnteil: 6_000,
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? null,
      amounts: options.amounts,
      splits: options.splits ?? [],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function hinweise(month: number) {
    const buchungen = await verprobung.journalBuchungen("2026-01-01", "2027-01-01");
    return verprobung.verprobungsZeilen({ year: 2026, month }, buchungen, "soll");
  }

  describe.each(["SKR03", "SKR04"] as const)("%s", (kr) => {
    it("Aufteilung: Position zu 0 % und Teilabzug auf derselben Kategorie, kein Hinweis", async () => {
      await reset(kr);
      await buche({
        amounts: [
          { taxRate: 1900, net: 15_000, tax: 2_850 },
          { taxRate: 0, net: 2_000, tax: 0 },
        ],
        splits: [
          { category: "buero", taxRate: 1900, net: 10_000 },
          { category: "software", taxRate: 1900, net: 5_000 },
          { category: "buero", taxRate: 0, net: 2_000 },
        ],
      });
      expect(await hinweise(9)).toEqual([]);
    });

    it("Aufteilung: ein Satz ohne Abzug neben einem anteiligen auf derselben Kategorie, kein Hinweis", async () => {
      await reset(kr);
      await buche({
        amounts: [
          { taxRate: 1900, net: 10_000, tax: 1_900 },
          { taxRate: 700, net: 3_000, tax: 210, vorsteuerAnteil: 0 },
        ],
        splits: [
          { category: "buero", taxRate: 1900, net: 10_000 },
          { category: "buero", taxRate: 700, net: 3_000 },
        ],
      });
      expect(await hinweise(9)).toEqual([]);
    });

    it("Position zu 0 % mit Privatanteil, Gutschrift, § 13b und Skonto: kein Hinweis", async () => {
      await reset(kr);
      const mitNull = (vorzeichen: 1 | -1): Amount[] => [
        { taxRate: 1900, net: vorzeichen * 9_999, tax: vorzeichen * 1_900 },
        { taxRate: 700, net: vorzeichen * 3_333, tax: vorzeichen * 233 },
        { taxRate: 0, net: vorzeichen * 777, tax: 0 },
      ];
      await buche({ amounts: mitNull(1), privateShare: 33 });
      await buche({ amounts: mitNull(-1) });
      await buche({ amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }], reverseCharge: "eu" });
      const id = await buche({ amounts: mitNull(1) });
      for (const amount of [-237, -3, -1_190]) await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-10-05", amount });
      expect([...(await hinweise(9)), ...(await hinweise(10))]).toEqual([]);
    });
  });
});
