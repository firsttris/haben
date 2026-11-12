import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274). Anlass: eine Telekom-Gutschrift von 489,95 EUR,
 * die nie abgebucht, sondern mit den Folgeabbuchungen verrechnet wurde. Bis dahin blieben Rechnung und
 * Gutschrift offen, weil Haben für einen Ausgleich einen Bankumsatz verlangte.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung zweier Belege ohne Zahlung (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    verrechnung = await import("./verrechnung.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma() {
    await leeren(sql)`truncate document_settlements, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, documents, document_amounts, document_splits, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 14)`;
  }

  /** Gebuchter Beleg über die Bank; net negativ ergibt eine Gutschrift des Lieferanten */
  async function beleg(datum: string, netto: number, steuer: number) {
    // Eigene Bytes je Beleg: gleiche Datei erkennt Haben als Dublette und gibt den ersten Beleg zurueck
    const bytes = new Uint8Array([...JPEG, datum.charCodeAt(9), Math.abs(netto) % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `${datum}-${netto}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Telekom Deutschland GmbH",
      supplierUstId: "",
      invoiceNumber: `R-${datum}-${netto}`,
      documentDate: datum,
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: netto, tax: steuer }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("gleicht Rechnung und Gutschrift aus und lässt bei Teilverrechnung den Rest offen", async () => {
    await firma();
    const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR
    expect(await verrechnung.openAmount(rechnung)).toBe(11_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);

    await verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount: 2_000, date: "2026-02-16", note: "Gutschrift" });

    expect(await verrechnung.openAmount(rechnung)).toBe(9_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-1_570);
    const zeilen = await verrechnung.listSettlements(rechnung);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ amount: -2_000 });

    // Mehr als der offene Rest der Gutschrift geht nicht
    await expect(
      verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount: 5_000, date: "2026-02-16", note: "Gutschrift" }),
    ).rejects.toThrow(/nicht verrechnen/);
  }, 30_000);

  it("hebt eine Verrechnung per Gegenzeile auf", async () => {
    await firma();
    const rechnung = await beleg("2026-03-10", 5_000, 950);
    const gutschrift = await beleg("2026-03-12", -3_000, -570);
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-03-12",
      note: "Gutschrift",
    });
    expect(await verrechnung.openAmount(rechnung)).toBe(2_380);
    expect(await verrechnung.openAmount(gutschrift)).toBe(0);

    await verrechnung.reverseSettlement(actor, ids[0]!);

    expect(await verrechnung.openAmount(rechnung)).toBe(5_950);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);
    await expect(verrechnung.reverseSettlement(actor, ids[0]!)).rejects.toThrow(/bereits/);
  }, 30_000);

  it("verweigert Belege, die in dieselbe Richtung zeigen", async () => {
    await firma();
    const eine = await beleg("2026-04-10", 1_000, 190);
    const andere = await beleg("2026-04-11", 2_000, 380);
    await expect(
      verrechnung.settleDocuments(actor, { documentId: eine, counterDocumentId: andere, amount: 500, date: "2026-04-11", note: "Gutschrift" }),
    ).rejects.toThrow(/dieselbe Richtung/);
  }, 30_000);

  it("verlangt ein Datum und den Grund und prueft das Datum", async () => {
    await firma();
    const rechnung = await beleg("2026-05-10", 10_000, 1_900);
    const gutschrift = await beleg("2026-05-20", -3_000, -570);
    const basis = { documentId: rechnung, counterDocumentId: gutschrift, amount: 1_000 };

    // ohne Datum und ohne Grund lehnt schon das Schema ab
    await expect(verrechnung.settleDocuments(actor, basis as never)).rejects.toThrow(/date|Grund/i);
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-20", note: "   " })).rejects.toThrow(/Grund/);
    // vor dem juengeren Beleg: Aufrechnung wirkt nicht rueckwirkend
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-19", note: "Gutschrift" })).rejects.toThrow(/jüngeren/);
    // in der Zukunft
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2099-01-01", note: "Gutschrift" })).rejects.toThrow(/Zukunft/);
    // am Tag des juengeren Belegs geht es
    await verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-20", note: "Gutschrift" });
    expect(await verrechnung.openAmount(rechnung)).toBe(10_900);
  }, 30_000);
});
