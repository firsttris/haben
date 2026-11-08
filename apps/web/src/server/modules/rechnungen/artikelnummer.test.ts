import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Text eines PDFs mit pdftotext -layout (poppler-utils); ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-artikelnummer-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", ["-layout", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Artikelnummer in der Position von Rechnung, Angebot und wiederkehrender Rechnung (#388, BT-155) */
describe.skipIf(!testDatabaseUrl)("Artikelnummer in Positionen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let recurring: typeof import("./recurring.ts");
  let orderDocuments: typeof import("./order-documents.ts");
  let externalReference: typeof import("./external-reference.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const lines = [
    { description: "Dichtungssatz", itemNumber: "ET-1042", quantity: 3000, unit: "Stk." as const, unitPrice: 1250, taxRate: 1900 as const },
    { description: "Montage vor Ort", quantity: 1000, unit: "Std." as const, unitPrice: 8500, taxRate: 1900 as const },
  ];

  const invoiceDraft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-09-01",
    serviceTo: "2026-09-30",
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "",
    lines,
    ...overrides,
  });

  const quoteDraft = () => ({
    contactId,
    issueDate: "2026-09-01",
    validUntil: "2026-09-30",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines,
  });

  const storedNumbers = async (invoiceId: string) =>
    (await sql`select item_number from invoice_lines where invoice_id = ${invoiceId} order by position`).map((r) => r.item_number);

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    recurring = await import("./recurring.ts");
    orderDocuments = await import("./order-documents.ts");
    externalReference = await import("./external-reference.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      recurring_invoices, invoice_number_counters, articles, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 14)`;
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
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  it("speichert die Artikelnummer der Position und schreibt sie in XML und PDF", async () => {
    const draft = await invoices.createDraft(actor, invoiceDraft({ lines: [{ ...lines[0]!, itemNumber: " ET-1042 " }, lines[1]!] }));
    expect(await storedNumbers(draft.id)).toEqual(["ET-1042", ""]);
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final.xml).toMatch(/<cac:SellersItemIdentification>\s*<cbc:ID>ET-1042<\/cbc:ID>/);
    expect(final.xml!.match(/<cac:SellersItemIdentification>/g)).toHaveLength(1);
    const text = pdfText(final.pdf!);
    if (text !== null) {
      expect(text).toContain("Art.-Nr.");
      expect(text).toMatch(/1\s+ET-1042\s+Dichtungssatz/);
    }
  });

  it("lässt eine festgeschriebene Rechnung unverändert, wenn sich die Nummer im Artikelstamm ändert", async () => {
    const [article] = await sql`insert into articles (number, description, unit, unit_price, tax_rate)
      values ('ET-1042', 'Dichtungssatz', 'Stk.', 1250, 1900) returning id`;
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
    await sql`update articles set number = 'ET-2000' where id = ${article!.id}`;
    expect(await storedNumbers(final.id)).toEqual(["ET-1042", ""]);
    // Die Position selbst ist mit der Rechnung gesperrt
    await expect(sql`update invoice_lines set item_number = 'ET-2000' where invoice_id = ${final.id}`).rejects.toThrow();
  });

  it("übernimmt die Artikelnummer in Storno und Rechnungskorrektur", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
    const correction = await invoices.createCorrection(actor, final.id, "2026-10-05");
    expect(await storedNumbers(correction.id)).toEqual(["ET-1042", ""]);
    await invoices.deleteDraft(actor, correction.id);
    const storno = await invoices.cancelInvoice(actor, final.id, "2026-10-05");
    expect(await storedNumbers(storno.id)).toEqual(["ET-1042", ""]);
    expect(storno.xml).toMatch(/<cac:SellersItemIdentification>\s*<cbc:ID>ET-1042<\/cbc:ID>/);
  });

  it("übernimmt die Artikelnummer aus dem Angebot in Rechnung und Kopie, im Angebot und Lieferschein steht sie", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteDraft())).id);
    const quoteText = pdfText(quote.pdf!);
    if (quoteText !== null) expect(quoteText).toMatch(/1\s+ET-1042\s+Dichtungssatz/);
    const copy = await quotes.copyQuote(actor, quote.id, "2026-10-01");
    expect((await quotes.getQuote(copy.id))!.lines.map((l) => l.itemNumber)).toEqual(["ET-1042", ""]);
    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-01");
    expect(await storedNumbers(invoice.id)).toEqual(["ET-1042", ""]);
    const note = pdfText((await orderDocuments.deliveryNotePdf("angebot", quote.id)).pdf);
    if (note !== null) expect(note).toMatch(/1\s+ET-1042\s+Dichtungssatz/);
  });

  it("zeigt die Artikelnummer im Lieferschein zur Rechnung", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
    const note = pdfText((await orderDocuments.deliveryNotePdf("rechnung", final.id)).pdf);
    if (note !== null) expect(note).toMatch(/1\s+ET-1042\s+Dichtungssatz/);
  });

  it("übernimmt die Artikelnummer aus der wiederkehrenden Rechnung", async () => {
    await recurring.createRecurring(actor, {
      name: "Ersatzteile Nordwerk",
      active: true,
      contactId,
      format: "zugferd",
      paymentTermDays: 14,
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      lines,
      intervalMonths: 1,
      nextDate: "2026-09-30",
      endDate: "2026-09-30",
      servicePeriod: "laufend",
      mode: "entwurf",
    });
    await recurring.runDueRecurring("2026-10-02");
    const [invoice] = await sql`select id from invoices`;
    expect(await storedNumbers(invoice!.id)).toEqual(["ET-1042", ""]);
  });

  it("behält die Artikelnummer, wenn die API nur andere Felder ändert", async () => {
    const draft = await invoices.createDraft(actor, invoiceDraft());
    const { invoice, lines: stored } = (await invoices.getInvoice(draft.id))!;
    expect(externalReference.draftInputOf(invoice, stored).lines.map((l) => l.itemNumber)).toEqual(["ET-1042", ""]);
  });

  it("weist zu lange Artikelnummern zurück", () => {
    expect(invoices.draftSchema.safeParse(invoiceDraft({ lines: [{ ...lines[0]!, itemNumber: "x".repeat(101) }] })).success).toBe(false);
  });

  it("speichert jede Position mit gültiger Artikelnummer auch als Artikel im Katalog", async () => {
    // Der Editor schickt die Nummer der Position beim „als Artikel speichern“ an den Katalog; was die Position annimmt,
    // muss der Katalog auch annehmen (Review #407)
    const { articleInputSchema } = await import("../stammdaten/articles.ts");
    const rejected = Array.from({ length: 200 }, (_, i) => "A".repeat(i + 1)).filter((itemNumber) => {
      const parsed = invoices.draftSchema.safeParse(invoiceDraft({ lines: [{ ...lines[0]!, itemNumber }] }));
      if (!parsed.success) return false;
      const line = parsed.data.lines[0]!;
      const article = articleInputSchema.safeParse({
        number: line.itemNumber,
        description: line.description,
        detail: line.detail,
        unit: line.unit,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
      });
      return !article.success;
    });
    expect(rejected.map((n) => n.length)).toEqual([]);
  });
});
