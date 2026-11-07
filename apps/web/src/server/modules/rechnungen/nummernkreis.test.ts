import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Monat im Nummernformat und durchlaufender Zähler (Postgres, #328)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("../stammdaten/number-formats.ts");
  const actor = "test-user";
  let contactId: string;

  const invoiceDraft = (issueDate = "2026-03-02") =>
    invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const quoteDraft = (issueDate = "2026-03-02") =>
    quotes.createQuoteDraft(actor, {
      contactId,
      issueDate,
      validUntil: issueDate,
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const finalizeNew = async (issueDate?: string) => (await invoices.finalizeInvoice(actor, (await invoiceDraft(issueDate)).id)).number;
  const finalizeQuote = async (issueDate?: string) => (await quotes.finalizeQuote(actor, (await quoteDraft(issueDate)).id)).number;
  const QUOTE = "AN-{JJJJ}-{NNN}";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("../stammdaten/contacts.ts");
    formats = await import("../stammdaten/number-formats.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "buchhaltung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  it("nimmt Jahr und Monat aus dem Rechnungsdatum; der jährliche Zähler beginnt im Januar neu", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{MM}-{NNNN}", quote: QUOTE });
    expect(await finalizeNew("2026-10-31")).toBe("RE-2026-10-0001");
    expect(await finalizeNew("2026-11-01")).toBe("RE-2026-11-0002");
    expect(await finalizeNew("2026-12-31")).toBe("RE-2026-12-0003");
    expect(await finalizeNew("2027-01-02")).toBe("RE-2027-01-0001");
  });

  it("lässt den Zähler auf Wunsch über den Jahreswechsel weiterlaufen, ab der letzten Nummer des Kreises", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{MM}-{NNNN}", quote: QUOTE });
    expect(await finalizeNew("2026-11-30")).toBe("RE-2026-11-0001");
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{MM}-{NNNN}", quote: QUOTE, invoiceRunning: true });
    expect(await finalizeNew("2026-12-31")).toBe("RE-2026-12-0002");
    expect(await finalizeNew("2027-01-02")).toBe("RE-2027-01-0003");
    const rows = await sql`select number, number_year, number_counter from invoices where status = 'final' order by number_counter`;
    expect(rows.map((r) => [r.number_year, r.number_counter])).toEqual([
      [2026, 1],
      [0, 2],
      [0, 3],
    ]);
    // Angebote zählen getrennt und beginnen weiter jährlich neu
    expect(await finalizeQuote("2026-12-31")).toBe("AN-2026-001");
    expect(await finalizeQuote("2027-01-02")).toBe("AN-2027-001");
  });

  it("schaltet den Zähler je Kreis um, auch nur für Angebote", async () => {
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "AN-{NNNN}", quoteRunning: true });
    expect(await finalizeQuote("2026-12-31")).toBe("AN-0001");
    expect(await finalizeQuote("2027-01-02")).toBe("AN-0002");
    expect(await finalizeNew("2027-01-02")).toBe("2027-001");
    const [company] = await sql`select invoice_counter_running, quote_counter_running from company`;
    expect(company).toEqual({ invoice_counter_running: false, quote_counter_running: true });
  });

  it("verlangt das Jahr nur, wenn der Zähler jährlich neu beginnt", async () => {
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{NNNN}", quote: QUOTE })).rejects.toThrow(/Rechnungen: .*Jahr/);
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{MM}-{NNNN}", quote: QUOTE })).rejects.toThrow(/Rechnungen: .*Jahr/);
    await formats.saveNumberFormats(actor, { invoice: "RE-{NNNN}", quote: QUOTE, invoiceRunning: true });
    // Ohne Angabe bleibt der Schalter, wie er ist
    await formats.saveNumberFormats(actor, { invoice: "RE-{NNNN}", quote: QUOTE });
    expect(await finalizeNew("2026-03-02")).toBe("RE-0001");
    // Zurück auf jährlich geht nur mit dem Jahr im Format
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{NNNN}", quote: QUOTE, invoiceRunning: false })).rejects.toThrow(/Jahr/);
  });

  it("setzt beim Umzug die nächste laufende Nummer je Kreis, auch für Angebote", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{NNNN}", quote: "AN-{NNNN}", invoiceRunning: true, quoteRunning: true });
    await invoices.setNextNumber(actor, "2026-11-07", 412);
    await invoices.setNextNumber(actor, "2026-11-07", 57, "angebot");
    expect(await invoices.numbering("2026-11-07")).toMatchObject({ running: true, last: 411, next: "RE-0412" });
    expect(await invoices.numbering("2026-11-07", "angebot")).toMatchObject({ running: true, last: 56, next: "AN-0057" });
    expect(await finalizeNew("2027-01-02")).toBe("RE-0412");
    expect(await finalizeQuote("2027-01-02")).toBe("AN-0057");
    await expect(invoices.setNextNumber(actor, "2026-11-07", 400)).rejects.toThrow(/größer als RE-0412/);
  });

  it("vergibt auch dem Storno die nächste Nummer des durchlaufenden Kreises", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: QUOTE, invoiceRunning: true });
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft("2026-12-30")).id);
    const storno = await invoices.cancelInvoice(actor, original.id, "2027-01-04");
    expect([original.number, storno.number]).toEqual(["RE-2026-0001", "RE-2027-0002"]);
  });
  it("zählt beim erneuten Einschalten des durchlaufenden Zählers hinter der letzten Nummer des Jahres weiter", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: QUOTE, invoiceRunning: true });
    expect(await finalizeNew("2026-03-02")).toBe("RE-2026-0001");
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: QUOTE, invoiceRunning: false });
    expect(await finalizeNew("2027-01-04")).toBe("RE-2027-0001");
    expect(await finalizeNew("2027-01-05")).toBe("RE-2027-0002");
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: QUOTE, invoiceRunning: true });
    expect(await finalizeNew("2027-02-01")).toBe("RE-2027-0003");
  });
});
