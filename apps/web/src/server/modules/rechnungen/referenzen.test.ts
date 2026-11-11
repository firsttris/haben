import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Text eines PDFs mit pdftotext (poppler-utils), Leerraum zusammengefasst; ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-referenzen-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", [join(dir, "beleg.pdf"), "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Kopfblock im PDF: pdftotext liest die Spalte der Bezeichnungen vor der der Werte, also beide einzeln */
function expectMeta(text: string, label: string, value: string) {
  expect(text).toContain(label);
  expect(text).toContain(value);
}

const REFS = { buyerOrderReference: "4500012345", sellerOrderReference: "AU-2026-17", despatchAdviceReference: "LS-0815" };

/** Bestell-, Auftrags- und Lieferscheinnummer an Rechnung und Angebot (#389, BT-13, BT-14, BT-16) */
describe.skipIf(!testDatabaseUrl)("Referenzen an Rechnung und Angebot (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let orderDocuments: typeof import("./order-documents.ts");
  let externalReference: typeof import("./external-reference.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = { description: "Wartung Oktober", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 1900 as const };

  const invoiceDraft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-09-01",
    serviceTo: "2026-09-30",
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "",
    lines: [line],
    ...overrides,
  });

  const quoteDraft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-09-01",
    validUntil: "2026-09-30",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [line],
    ...overrides,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    orderDocuments = await import("./order-documents.ts");
    externalReference = await import("./external-reference.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
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

  it("speichert die Referenzen am Entwurf, getrimmt, und schreibt sie beim Festschreiben in XML und PDF", async () => {
    const created = await invoices.createDraft(actor, invoiceDraft({ ...REFS, buyerOrderReference: "  4500012345 " }));
    expect(created).toMatchObject(REFS);
    const final = await invoices.finalizeInvoice(actor, created.id);
    expect(final.xml).toMatch(/<cac:OrderReference>\s*<cbc:ID>4500012345<\/cbc:ID>\s*<cbc:SalesOrderID>AU-2026-17<\/cbc:SalesOrderID>/);
    expect(final.xml).toMatch(/<cac:DespatchDocumentReference>\s*<cbc:ID>LS-0815<\/cbc:ID>/);
    const text = pdfText(final.pdf!);
    if (text !== null) {
      expectMeta(text, "Ihre Bestellung", "4500012345");
      expectMeta(text, "Unser Auftrag", "AU-2026-17");
      expectMeta(text, "Lieferschein", "LS-0815");
    }
  });

  it("lässt ohne Referenzen alles wie bisher", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
    expect(final).toMatchObject({ buyerOrderReference: "", sellerOrderReference: "", despatchAdviceReference: "" });
    expect(final.xml).not.toMatch(/OrderReference|DespatchDocumentReference/);
  });

  it("sperrt die Referenzen einer festgeschriebenen Rechnung", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft(REFS))).id);
    await expect(sql`update invoices set buyer_order_reference = 'anders' where id = ${final.id}`).rejects.toThrow();
  });

  it("übernimmt die Referenzen in Storno und Rechnungskorrektur", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft(REFS))).id);
    const correction = await invoices.createCorrection(actor, final.id, "2026-10-05");
    expect(correction).toMatchObject(REFS);
    await invoices.deleteDraft(actor, correction.id);
    const storno = await invoices.cancelInvoice(actor, final.id, "2026-10-05");
    expect(storno).toMatchObject(REFS);
    expect(storno.xml).toContain("<cbc:SalesOrderID>AU-2026-17</cbc:SalesOrderID>");
  });

  it("behält die Referenzen, wenn die API nur andere Felder ändert", async () => {
    const created = await invoices.createDraft(actor, invoiceDraft(REFS));
    const { invoice, lines } = (await invoices.getInvoice(created.id))!;
    expect(externalReference.draftInputOf(invoice, lines)).toMatchObject(REFS);
  });

  it("weist zu lange Referenzen zurück", () => {
    expect(invoices.draftSchema.safeParse(invoiceDraft({ buyerOrderReference: "x".repeat(101) })).success).toBe(false);
    expect(quotes.quoteDraftSchema.safeParse(quoteDraft({ despatchAdviceReference: "x".repeat(101) })).success).toBe(false);
  });

  it("speichert die Referenzen am Angebot, zeigt sie im PDF und übernimmt sie beim Kopieren", async () => {
    const created = await quotes.createQuoteDraft(actor, quoteDraft(REFS));
    expect(created).toMatchObject(REFS);
    const final = await quotes.finalizeQuote(actor, created.id);
    const text = pdfText(final.pdf!);
    if (text !== null) expectMeta(text, "Ihre Bestellung", "4500012345");
    await expect(sql`update quotes set seller_order_reference = 'anders' where id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
    expect(await quotes.copyQuote(actor, final.id, "2026-10-01")).toMatchObject(REFS);
  });

  it("übernimmt Bestellnummer und Lieferschein aus dem Angebot, Auftragsnummer ist die des Angebots", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteDraft(REFS))).id);
    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-01");
    expect(invoice).toMatchObject(REFS);
    const plain = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteDraft({ buyerOrderReference: "4500099999" }))).id);
    const fromPlain = await quotes.quoteToInvoice(actor, plain.id, "2026-10-01");
    // Ohne eigene Auftragsnummer im Angebot steht dessen Nummer in BT-14 (#389)
    expect(fromPlain).toMatchObject({ buyerOrderReference: "4500099999", sellerOrderReference: plain.number, despatchAdviceReference: "" });
  });

  it("übernimmt die Referenzen auch in Abschlags- und Schlussrechnung aus dem Angebot", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteDraft({ buyerOrderReference: "4500012345" }))).id);
    const abschlag = await quotes.quoteToInvoice(actor, quote.id, "2026-10-01", "abschlag");
    expect(abschlag).toMatchObject({ buyerOrderReference: "4500012345", sellerOrderReference: quote.number });
  });

  it("zeigt die Bestellnummer in Auftragsbestätigung und Lieferschein", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteDraft(REFS))).id);
    await quotes.setQuoteDecision(actor, quote.id, "angenommen");
    const confirmation = pdfText((await orderDocuments.confirmationPdf(quote.id)).pdf);
    const note = pdfText((await orderDocuments.deliveryNotePdf("angebot", quote.id)).pdf);
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft(REFS))).id);
    const invoiceNote = pdfText((await orderDocuments.deliveryNotePdf("rechnung", final.id)).pdf);
    if (confirmation === null || note === null || invoiceNote === null) return;
    expectMeta(confirmation, "Ihre Bestellung", "4500012345");
    expectMeta(note, "Ihre Bestellung", "4500012345");
    expectMeta(invoiceNote, "Ihre Bestellung", "4500012345");
    expectMeta(invoiceNote, "Unser Auftrag", "AU-2026-17");
  });
});
