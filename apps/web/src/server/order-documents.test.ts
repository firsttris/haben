import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Auftragsbestätigung und Lieferschein (Postgres)", () => {
  let docs: typeof import("./order-documents.ts");
  let quotes: typeof import("./quotes.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  const lines = [{ description: "Workshop Architektur", quantity: 2000, unit: "Tag" as const, unitPrice: 120_000, taxRate: 1900 as const }];

  beforeAll(async () => {
    sql = await setupTestDb();
    docs = await import("./order-documents.ts");
    quotes = await import("./quotes.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
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
        kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  });

  it("Auftragsbestätigung und Lieferschein erst zum angenommenen Angebot", async () => {
    const quote = await quotes.finalizeQuote(
      actor,
      (await quotes.createQuoteDraft(actor, { contactId, issueDate: "2026-10-01", validUntil: "2026-10-31", serviceFrom: null, serviceTo: null, note: "", lines })).id,
    );
    await expect(docs.confirmationPdf(quote.id)).rejects.toThrow(/nicht als angenommen/);
    await quotes.setQuoteDecision(actor, quote.id, "angenommen");
    const confirmation = await docs.confirmationPdf(quote.id);
    expect(confirmation.filename).toBe("Auftragsbestaetigung-AN-2026-001.pdf");
    expect(Buffer.from(confirmation.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect((await docs.deliveryNotePdf("angebot", quote.id)).filename).toBe("Lieferschein-AN-2026-001.pdf");
    // Nichts gebucht, nichts gespeichert
    expect(await sql`select 1 from journal_entries`).toHaveLength(0);
  });

  it("Lieferschein zur Rechnung, nicht zur Stornorechnung", async () => {
    const invoice = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, { contactId, issueDate: "2026-10-02", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "", lines })).id,
    );
    const note = await docs.deliveryNotePdf("rechnung", invoice.id);
    expect(note.filename).toBe("Lieferschein-2026-001.pdf");
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-10-03");
    await expect(docs.deliveryNotePdf("rechnung", storno.id)).rejects.toThrow(/nur zu festgeschriebenen Rechnungen/);
  });
});
