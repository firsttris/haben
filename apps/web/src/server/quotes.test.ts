import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Angebote (Postgres)", () => {
  let quotes: typeof import("./quotes.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (unitPrice: number, taxRate: 1900 | 700 | 0 = 1900, quantity = 1000) => ({
    description: "Workshop Architektur",
    quantity,
    unit: "Std." as const,
    unitPrice,
    taxRate,
  });

  const draft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    validUntil: "2026-10-31",
    serviceFrom: "2026-11-01",
    serviceTo: "2026-11-30",
    note: "",
    lines: [line(9500, 1900, 40_000)],
    ...overrides,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    quotes = await import("./quotes.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 21)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "einkauf@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: "xrechnung-cii",
    });
    contactId = contact.id;
  });

  it("schreibt mit eigenem Nummernkreis fest, erzeugt das PDF und bucht nichts", async () => {
    const first = await quotes.createQuoteDraft(actor, draft());
    expect(first).toMatchObject({ net: 380_000, tax: 72_200, gross: 452_200, status: "draft", number: null });
    const second = await quotes.createQuoteDraft(actor, draft());
    expect((await quotes.finalizeQuote(actor, second.id)).number).toBe("AN-2026-001");
    const final = await quotes.finalizeQuote(actor, first.id);
    expect(final.number).toBe("AN-2026-002");
    expect(final.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(final.buyer).toMatchObject({ name: "Nordwerk Software GmbH" });
    expect(await sql`select 1 from journal_entries`).toHaveLength(0);
    expect(await sql`select 1 from invoice_number_counters`).toHaveLength(0);
    await expect(quotes.updateQuoteDraft(actor, first.id, draft())).rejects.toThrow(/festgeschrieben/);
  });

  it("prüft vor dem Festschreiben", async () => {
    const empty = await quotes.createQuoteDraft(actor, draft({ contactId: null, lines: [] }));
    expect(await quotes.quoteIssues(empty.id)).toEqual(["Kunde fehlt", "Keine Positionen", "Angebotssumme muss positiv sein"]);
    await expect(quotes.finalizeQuote(actor, empty.id)).rejects.toThrow(/Noch nicht bereit/);
    await expect(quotes.createQuoteDraft(actor, draft({ validUntil: "2026-09-30" }))).rejects.toThrow(/mindestens bis/);
  });

  it("sperrt das festgeschriebene Angebot in der Datenbank, nur die Antwort darf sich ändern", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft())).id);
    await expect(sql`update quotes set gross = 1 where id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from quotes where id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update quote_lines set unit_price = 1 where quote_id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
    await quotes.setQuoteDecision(actor, quote.id, "abgelehnt");
    expect(quotes.quoteStatus((await quotes.getQuote(quote.id))!.quote, "2026-10-05")).toBe("abgelehnt");
    await expect(quotes.quoteToInvoice(actor, quote.id, "2026-10-05")).rejects.toThrow(/abgelehnt/);
    await quotes.setQuoteDecision(actor, quote.id, null);
    expect(quotes.quoteStatus((await quotes.getQuote(quote.id))!.quote, "2026-10-05")).toBe("offen");
    expect(quotes.quoteStatus((await quotes.getQuote(quote.id))!.quote, "2026-11-01")).toBe("abgelaufen");
  });

  it("macht aus dem Angebot einen Rechnungsentwurf, einmal", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft({ lines: [line(9500), line(2000, 700, 3000)] }))).id);
    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-20");
    expect(invoice).toMatchObject({
      status: "draft",
      contactId,
      issueDate: "2026-10-20",
      paymentTermDays: 21,
      format: "xrechnung-cii",
      serviceFrom: "2026-11-01",
      serviceTo: "2026-11-30",
      net: quote.net,
      gross: quote.gross,
      note: "Gemäß unserem Angebot AN-2026-001 vom 01.10.2026.",
    });
    const detail = (await quotes.getQuote(quote.id))!;
    expect(detail.quote).toMatchObject({ decision: "angenommen", invoiceId: invoice.id });
    expect(quotes.quoteStatus(detail.quote, "2026-12-01")).toBe("abgerechnet");
    await expect(quotes.quoteToInvoice(actor, quote.id, "2026-10-20")).rejects.toThrow(/bereits eine Rechnung/);
    await expect(quotes.setQuoteDecision(actor, quote.id, null)).rejects.toThrow(/bereits eine Rechnung/);

    // Wird der Rechnungsentwurf gelöscht, lässt sich das Angebot wieder abrechnen
    await invoices.deleteDraft(actor, invoice.id);
    expect((await quotes.getQuote(quote.id))!.quote.invoiceId).toBeNull();
    const again = await quotes.quoteToInvoice(actor, quote.id, "2026-10-21");
    expect(again.issueDate).toBe("2026-10-21");
  });

  it("kopiert ein Angebot als neuen Entwurf mit gleicher Gültigkeitsdauer", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft())).id);
    const copy = await quotes.copyQuote(actor, quote.id, "2026-12-01");
    expect(copy).toMatchObject({ status: "draft", issueDate: "2026-12-01", validUntil: "2026-12-31", net: quote.net, serviceFrom: null });
    expect((await quotes.listQuotes("2026-12-01")).map((q) => q.listStatus)).toEqual(["entwurf", "abgelaufen"]);
  });
});
