import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Angebote (Postgres)", () => {
  let quotes: typeof import("./quotes.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
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
    contacts = await import("../stammdaten/contacts.ts");
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

  it("Abschläge mit Bezug zum Angebot; die Schlussrechnung zieht nur die Abschläge dieses Angebots ab", async () => {
    // Der Kunde bekommt XRechnung, die verlangt eine Telefonnummer des Verkäufers
    await sql`update company set telefon = '+49 941 123456'`;
    // Angebot über 3.800,00 € netto (40 Std. × 95,00 €) und ein zweites Angebot desselben Kunden
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft())).id);
    const other = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft({ lines: [line(50_000)] }))).id);

    /** Abschlag aus dem Angebot anlegen, Betrag eintragen und festschreiben */
    const abschlag = async (quoteId: string, net: number, day: string) => {
      const created = await quotes.quoteToInvoice(actor, quoteId, day, "abschlag");
      const { invoice, lines } = (await invoices.getInvoice(created.id))!;
      await invoices.updateDraft(actor, invoice.id, {
        contactId: invoice.contactId,
        issueDate: invoice.issueDate,
        serviceFrom: invoice.serviceFrom,
        serviceTo: invoice.serviceTo,
        paymentTermDays: invoice.paymentTermDays,
        format: invoice.format,
        note: invoice.note,
        variant: "abschlag",
        quoteId: invoice.quoteId,
        lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit as "Psch.", unitPrice: net, taxRate: l.taxRate as 1900 })),
      });
      return invoices.finalizeInvoice(actor, invoice.id);
    };

    const draftAbschlag = await quotes.quoteToInvoice(actor, quote.id, "2026-10-05", "abschlag");
    expect(draftAbschlag).toMatchObject({ variant: "abschlag", quoteId: quote.id, contactId, status: "draft" });
    const { lines: abschlagLines } = (await invoices.getInvoice(draftAbschlag.id))!;
    expect(abschlagLines.map((l) => [l.description, l.unitPrice, l.taxRate])).toEqual([["Abschlag gemäß Angebot AN-2026-001 vom 01.10.2026", 0, 1900]]);
    expect(await invoices.finalizeIssues(draftAbschlag.id)).toContain("Position ohne Betrag");
    // Ein Abschlag rechnet das Angebot noch nicht ab: weitere Abschläge und die Schlussrechnung bleiben möglich
    expect((await quotes.getQuote(quote.id))!.quote).toMatchObject({ decision: "angenommen", invoiceId: null });
    await invoices.deleteDraft(actor, draftAbschlag.id);

    const first = await abschlag(quote.id, 114_000, "2026-10-05");
    const second = await abschlag(quote.id, 152_000, "2026-11-05");
    const foreign = await abschlag(other.id, 10_000, "2026-11-06");

    const schluss = await quotes.quoteToInvoice(actor, quote.id, "2026-12-01", "schluss");
    const { invoice, lines } = (await invoices.getInvoice(schluss.id))!;
    expect(invoice).toMatchObject({ variant: "schluss", quoteId: quote.id });
    expect(new Set(lines.flatMap((l) => (l.deductionOf ? [l.deductionOf] : [])))).toEqual(new Set([first.id, second.id]));
    // Rest: 3.800,00 − 1.140,00 − 1.520,00 = 1.140,00 € netto
    expect(invoice.net).toBe(114_000);
    expect(await invoices.finalizeIssues(schluss.id)).toEqual([]);

    const detail = (await quotes.getQuote(quote.id))!;
    expect(detail.quote.invoiceId).toBe(schluss.id);
    expect(detail.billing.map((b) => [b.id, b.variant, b.status])).toEqual([
      [first.id, "abschlag", "final"],
      [second.id, "abschlag", "final"],
      [schluss.id, "schluss", "draft"],
    ]);
    expect((await quotes.getQuote(other.id))!.billing.map((b) => b.id)).toEqual([foreign.id]);
  });

  it("Bezug zu einem Angebot eines anderen Kunden verhindert das Festschreiben", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft())).id);
    const stranger = await contacts.createContact(actor, {
      kundennummer: "10002",
      name: "Alpenblick GmbH",
      strasse: "Bergweg 1",
      plz: "83471",
      ort: "Berchtesgaden",
      land: "DE",
      email: "info@alpenblick.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const invoice = await invoices.createDraft(actor, {
      contactId: stranger.id,
      issueDate: "2026-10-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      quoteId: quote.id,
      lines: [line(10_000)],
    });
    expect(await invoices.finalizeIssues(invoice.id)).toContain("Angebot AN-2026-001 gehört zu einem anderen Kunden");
  });

  it("kopiert ein Angebot als neuen Entwurf mit gleicher Gültigkeitsdauer", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft())).id);
    const copy = await quotes.copyQuote(actor, quote.id, "2026-12-01");
    expect(copy).toMatchObject({ status: "draft", issueDate: "2026-12-01", validUntil: "2026-12-31", net: quote.net, serviceFrom: null });
    expect((await quotes.listQuotes("2026-12-01")).map((q) => q.listStatus)).toEqual(["entwurf", "abgelaufen"]);
  });
});
