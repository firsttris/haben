import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Musterlieferant GmbH",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("Vorsteuer aus Gutschriften erst mit der Erstattung (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const februar = { year: 2026, month: 2 };
  const maerz = { year: 2026, month: 3 };
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/index.ts");
    documents = await import("../belege/documents.ts");
    verrechnung = await import("../bank/verrechnung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate document_settlements, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    // Nebenbücher statt Journal: Das Journal bucht eine Verrechnung nicht (#274), die Voranmeldung rechnet sie deshalb
    // vor dem Stichjahr aus den Nebenbüchern (docs/adr/journal-als-quelle.md).
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 2027)`;
  });

  /** Bucht einen Beleg; negative Beträge sind eine Gutschrift */
  async function beleg(date: string, amounts: { taxRate: 1900 | 700; net: number; tax: number }[]) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ++lauf, 16, 74, 70]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Musterlieferant GmbH",
      supplierUstId: "",
      invoiceNumber: `GUT-${lauf}`,
      documentDate: date,
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      amounts,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Bankumsatz und Zuordnung auf einen Beleg; der Betrag trägt das Vorzeichen des Umsatzes */
  async function zahle(date: string, purpose: string, amount: number, documentId: string) {
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([eingang(date, purpose, (amount / 100).toFixed(2).replace(".", ","))]), filename: `${purpose}.csv` },
      null,
    );
    const [tx] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "document", transactionId: tx!.id as string, documentId, amount });
  }

  it("Gutschrift im Februar, Erstattung im März: Februar ohne, März mit der Vorsteuer", async () => {
    await beleg("2026-02-10", [{ taxRate: 1900, net: 100_000, tax: 19_000 }]);
    // Jahresabrechnung des Versorgers: 439,56 € brutto, davon 70,18 € Vorsteuer
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }]);

    const vorher = await figures.computeVatFigures(februar);
    expect(vorher.kz66).toBe(19_000);
    expect(vorher.inputTax.map((r) => r.documentId)).not.toContain(gutschrift);

    await zahle("15.03.26", "Erstattung Stadtwerke", 43_956, gutschrift);
    const nachher = await figures.computeVatFigures(maerz);
    expect(nachher.kz66).toBe(-7_018);
    expect(nachher.inputTax.map(({ number: _nummer, ...rest }) => rest)).toEqual([
      { documentId: gutschrift, date: "2026-03-15", supplier: "Musterlieferant GmbH", rate: 1900, base: -36_938, tax: -7_018 },
    ]);
    // Über das Jahr bleibt die Vorsteuer dieselbe, nur die Verteilung ändert sich
    expect((await figures.computeVatFigures(februar)).kz66 + nachher.kz66).toBe(19_000 - 7_018);
  }, 60_000);

  it("Verrechnung mit einer Rechnung: die Vorsteuer mindert sich im Monat der Aufrechnung", async () => {
    await beleg("2026-02-10", [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
    const gutschrift = await beleg("2026-02-16", [{ taxRate: 1900, net: -3_000, tax: -570 }]);
    const rechnung = await beleg("2026-02-20", [{ taxRate: 1900, net: 5_000, tax: 950 }]);
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-04-20",
      note: "Gutschrift verrechnet",
    });

    expect((await figures.computeVatFigures(februar)).kz66).toBe(1_900 + 950);
    expect((await figures.computeVatFigures(maerz)).kz66).toBe(0);
    const april = await figures.computeVatFigures({ year: 2026, month: 4 });
    expect(april.kz66).toBe(-570);
    expect(april.inputTax.map(({ number: _nummer, ...rest }) => rest)).toEqual([
      { documentId: gutschrift, date: "2026-04-20", supplier: "Musterlieferant GmbH", rate: 1900, base: -3_000, tax: -570 },
    ]);
  }, 60_000);

  it("Teilerstattung und Ausbuchung: je Vorgang anteilig nach Steuersatz", async () => {
    // Gutschrift über 1.297,00 € brutto: 1.000,00 € zu 19 % und 100,00 € zu 7 %
    const gutschrift = await beleg("2026-02-16", [
      { taxRate: 1900, net: -100_000, tax: -19_000 },
      { taxRate: 700, net: -10_000, tax: -700 },
    ]);
    await zahle("15.03.26", "Teilerstattung", 64_850, gutschrift);
    const maerz66 = (await figures.computeVatFigures(maerz)).kz66;
    expect(maerz66).toBe(-9_850);

    // Den Rest bucht die Ausbuchung im April aus (§ 17 Abs. 1 UStG), die Vorsteuer folgt dort
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: gutschrift, date: "2026-04-30" });
    const april = await figures.computeVatFigures({ year: 2026, month: 4 });
    expect(april.kz66).toBe(-9_850);
    expect(april.inputTax.map((r) => [r.rate, r.base, r.tax])).toEqual([
      [1900, -50_000, -9_500],
      [700, -5_000, -350],
    ]);
    expect(maerz66 + april.kz66).toBe(-19_700);
  }, 60_000);
});
