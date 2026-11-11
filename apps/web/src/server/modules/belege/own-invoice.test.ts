import { execFileSync } from "node:child_process";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { invoiceDocument, ownSeller } from "./own-invoice-fixtures.ts";

// Die KI wird nicht aufgerufen; je Test liefert die Auslesung feste Werte oder ist gar nicht eingerichtet.
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return { ...original, extractionAvailable: vi.fn(() => true), extractDocument: vi.fn() };
});

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

const kiFields = {
  supplierName: "Musterdesign Weber",
  supplierUstId: "DE811907980",
  invoiceNumber: "RE-2026-042",
  documentDate: "2026-10-01",
  dueDate: null,
  currency: "EUR",
  category: "werbung" as const,
  amounts: [{ taxRate: 1900 as const, net: 50_000, tax: 9_500 }],
  warnings: [],
};

const kiExtraction = {
  lieferant: "Musterdesign Weber",
  lieferantUstId: "DE811907980",
  empfaenger: "Kunde AG",
  empfaengerUstId: null,
  rechnungsnummer: "RE-2026-042",
  belegdatum: "2026-10-01",
  faelligAm: null,
  waehrung: "EUR",
  istGutschrift: false,
  betraege: [{ steuersatz: "19" as const, netto: "500.00", steuer: "95.00" }],
  brutto: "595.00",
  kategorie: "werbung" as const,
  hinweis: null,
};

describe.skipIf(!testDatabaseUrl)("Eigene Ausgangsrechnung beim Beleg-Upload erkennen (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let extraction: typeof import("./extraction.ts");
  let einvoice: typeof import("@haben/einvoice");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    extraction = await import("./extraction.ts");
    einvoice = await import("@haben/einvoice");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    vi.mocked(extraction.extractionAvailable).mockReturnValue(true);
    vi.mocked(extraction.extractDocument).mockReset();
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, exchange_rates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, kontenrahmen, ust_id, steuernummer, bundesland, iban, plz)
      values (1, ${ownSeller.name}, 'SKR03', ${ownSeller.ustId}, ${ownSeller.steuernummer}, 'BW', ${ownSeller.iban}, ${ownSeller.plz})`;
  });

  it("eigene ZUGFeRD-Rechnung: Hinweis statt Ausgabe, ohne Kategorie", async () => {
    const { pdf } = await einvoice.buildEInvoice(invoiceDocument("eigene"));
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "RE-2026-042.pdf" });
    const { document } = (await documents.getDocument(id))!;
    expect(document).toMatchObject({ extractedBy: "zugferd", extractionStatus: "fertig", category: null, invoiceNumber: "RE-2026-042" });
    expect(document.extractionError).toMatch(/^Das ist eine eigene Ausgangsrechnung, keine Ausgabe\./);
    expect(document.extraction).toMatchObject({ eigeneRechnung: { stufe: "sicher" } });
    expect(extraction.extractDocument).not.toHaveBeenCalled();
  });

  it("ZUGFeRD-Rechnung eines Lieferanten an uns bleibt ein normaler Beleg", async () => {
    const { pdf } = await einvoice.buildEInvoice(invoiceDocument("eingang"));
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "DS-77812.pdf" });
    const { document } = (await documents.getDocument(id))!;
    expect(document).toMatchObject({ extractedBy: "zugferd", supplierName: "Druckerei Schulze GmbH", extractionError: null });
    expect(document.extraction).not.toHaveProperty("eigeneRechnung");
  });

  it("KI nennt die eigene Firma als Rechnungssteller: keine Kategorie, Hinweis vor den Warnungen", async () => {
    vi.mocked(extraction.extractDocument).mockResolvedValueOnce({ extraction: kiExtraction, fields: { ...kiFields, warnings: ["Datum unleserlich"] } });
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "foto.jpg" });
    const { document } = (await documents.getDocument(id))!;
    expect(document).toMatchObject({ extractedBy: "ki", category: null, supplierName: "Musterdesign Weber" });
    expect(document.extractionError).toMatch(/^Das ist eine eigene Ausgangsrechnung.*· Datum unleserlich$/);
  });

  it("KI-Auslesung eines fremden Belegs: Kategorie wie bisher, kein Hinweis", async () => {
    vi.mocked(extraction.extractDocument).mockResolvedValueOnce({
      extraction: {
        ...kiExtraction,
        lieferant: "Druckerei Schulze GmbH",
        lieferantUstId: "DE812871812",
        empfaenger: ownSeller.name,
        empfaengerUstId: ownSeller.ustId,
      },
      fields: { ...kiFields, supplierName: "Druckerei Schulze GmbH", supplierUstId: "DE812871812" },
    });
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 1]), filename: "druck.jpg" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ category: "werbung", extractionError: null });
  });

  it.skipIf(!hasPdftotext)("ohne KI-Auslesung: eigene PDF-Rechnung ohne XML an der Textebene erkannt", async () => {
    vi.mocked(extraction.extractionAvailable).mockReturnValue(false);
    const pdf = einvoice.renderInvoicePdf(invoiceDocument("eigene"));
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "shop-rechnung.pdf" });
    const { document } = (await documents.getDocument(id))!;
    expect(document).toMatchObject({ extractionStatus: "fertig", extractedBy: null, category: null });
    expect(document.extractionError).toMatch(/^Das ist eine eigene Ausgangsrechnung/);
    expect(document.extraction).toMatchObject({ eigeneRechnung: { stufe: "sicher" } });
  });

  it.skipIf(!hasPdftotext)("ohne KI-Auslesung: PDF eines Lieferanten bleibt unberührt", async () => {
    vi.mocked(extraction.extractionAvailable).mockReturnValue(false);
    const pdf = einvoice.renderInvoicePdf(invoiceDocument("eingang"));
    const { id } = await documents.uploadDocument(actor, { bytes: pdf, filename: "lieferant.pdf" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ extractionStatus: "keine", extractionError: null, extraction: null });
  });

  it("Rechnung, die es in Haben gibt: nur mit gleicher Nummer und gleichem Betrag", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const rechnungen = await import("../rechnungen/index.ts");
    await sql`update company set strasse = ${ownSeller.strasse}, ort = ${ownSeller.ort}, email = ${ownSeller.email} where id = 1`;
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "10001",
      name: "Kunde AG",
      strasse: "Hauptstraße 5",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
      email: "a@kunde.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await rechnungen.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-10-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Gestaltung Flyer", quantity: 1000, unit: "Psch.", unitPrice: 50_000, taxRate: 1900 }],
    });
    const { number } = await rechnungen.finalizeInvoice(actor, draft.id);
    // Die KI erkennt keinen Rechnungssteller, nur Nummer und Beträge
    const anonymous = { ...kiExtraction, lieferant: null, lieferantUstId: null, empfaenger: null };
    const fields = { ...kiFields, supplierName: "", supplierUstId: "", invoiceNumber: number! };
    vi.mocked(extraction.extractDocument)
      .mockResolvedValueOnce({ extraction: anonymous, fields })
      .mockResolvedValueOnce({ extraction: anonymous, fields: { ...fields, amounts: [{ taxRate: 1900, net: 40_000, tax: 7_600 }] } });

    const same = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 2]), filename: "a.jpg" });
    const sameDoc = (await documents.getDocument(same.id))!.document;
    expect(sameDoc.extractionError).toContain(`Die Rechnung ${number} hast du in Haben geschrieben.`);
    expect(sameDoc.category).toBeNull();

    const other = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 3]), filename: "b.jpg" });
    expect((await documents.getDocument(other.id))!.document).toMatchObject({ extractionError: null, category: "werbung" });
  });
});
