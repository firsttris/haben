import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Nummernformat (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("../stammdaten/number-formats.ts");
  const actor = "test-user";
  let contactId: string;

  const invoiceDraft = () =>
    invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-03-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const quoteDraft = () =>
    quotes.createQuoteDraft(actor, {
      contactId,
      issueDate: "2026-03-02",
      validUntil: "2026-03-31",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const finalizeNew = async () => (await invoices.finalizeInvoice(actor, (await invoiceDraft()).id)).number;

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

  it("nummeriert ab Werk wie bisher", async () => {
    expect(await finalizeNew()).toBe("2026-001");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("AN-2026-001");
  });

  it("nummeriert Rechnungen und Angebote im eigenen Format und zeigt die nächste Nummer darin", async () => {
    await formats.saveNumberFormats(actor, { invoice: " RE-{JJJJ}-{NNNN} ", quote: "ANG{JJ}{NN}" });
    expect(await finalizeNew()).toBe("RE-2026-0001");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("ANG2601");
    expect(await invoices.numbering("2026-03-02")).toMatchObject({ last: 1, next: "RE-2026-0002" });
    const [company] = await sql`select invoice_number_format from company`;
    expect(company!.invoice_number_format).toBe("RE-{JJJJ}-{NNNN}");
  });

  it("lehnt ungültige Formate ab und lässt das gespeicherte stehen", async () => {
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{NNN}", quote: "AN-{JJJJ}-{NNN}" })).rejects.toThrow(/Rechnungen: .*Jahr/);
    await expect(formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "AN/{JJJJ}/{NNN}" })).rejects.toThrow(/Angebote: /);
    const [company] = await sql`select invoice_number_format, quote_number_format from company`;
    expect(company).toEqual({ invoice_number_format: "{JJJJ}-{NNN}", quote_number_format: "AN-{JJJJ}-{NNN}" });
  });

  it("meldet nach einem Formatwechsel eine schon vergebene Nummer, ohne den Zähler zu verbrauchen", async () => {
    // Nr. 1 im alten Format ergibt 2026-12, Nr. 2 im neuen ebenfalls
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{N}2", quote: "AN-{JJJJ}-{NNN}" });
    expect(await finalizeNew()).toBe("2026-12");
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-1{N}", quote: "AN-{JJJJ}-{NNN}" });
    const draft = await invoiceDraft();
    await expect(invoices.finalizeInvoice(actor, draft.id)).rejects.toThrow(/2026-12 ist schon vergeben/);
    const [counter] = await sql`select last from invoice_number_counters where year = 2026`;
    expect(counter!.last).toBe(1);
    expect((await sql`select status from invoices where id = ${draft.id}`)[0]!.status).toBe("draft");
    // Mit einem passenden Format geht es mit Nr. 2 weiter
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}" });
    expect((await invoices.finalizeInvoice(actor, draft.id)).number).toBe("RE-2026-002");
  });

  it("meldet auch bei Angeboten eine schon vergebene Nummer", async () => {
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "A{JJJJ}-{N}2" });
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("A2026-12");
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "A{JJJJ}-1{N}" });
    await expect(quotes.finalizeQuote(actor, (await quoteDraft()).id)).rejects.toThrow(/A2026-12 ist schon vergeben/);
  });
});
