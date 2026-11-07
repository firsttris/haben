import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { ownSeller } from "./own-invoice-fixtures.ts";

// TDD-Review PR #362: Rechnung, die es in Haben gibt, in Fremdwährung

vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return { ...original, extractionAvailable: vi.fn(() => true), extractDocument: vi.fn() };
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 8, 7]);

describe.skipIf(!testDatabaseUrl)("Review: eigene Rechnung in Fremdwährung (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let extraction: typeof import("./extraction.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    extraction = await import("./extraction.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    vi.mocked(extraction.extractDocument).mockReset();
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters, exchange_rates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, kontenrahmen, ust_id, steuernummer, bundesland, iban, plz, strasse, ort, email, versteuerung)
      values (1, ${ownSeller.name}, 'SKR03', ${ownSeller.ustId}, ${ownSeller.steuernummer}, 'BW', ${ownSeller.iban}, ${ownSeller.plz},
              ${ownSeller.strasse}, ${ownSeller.ort}, ${ownSeller.email}, 'soll')`;
  });

  it("GBP-Rechnung aus Haben: gleiche Nummer und gleicher Betrag in der Rechnungswährung ergeben den Hinweis", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const rechnungen = await import("../rechnungen/index.ts");
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
    // 500,00 GBP + 19 % = 595,00 GBP; in Euro mit Kurs 0,85: 588,24 € + 111,76 €
    const draft = await rechnungen.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-10-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      currency: "GBP",
      exchangeRate: "0,85",
      lines: [{ description: "Gestaltung Flyer", quantity: 1000, unit: "Psch.", unitPrice: 50_000, taxRate: 1900 }],
    });
    const { number } = await rechnungen.finalizeInvoice(actor, draft.id);

    // Die KI liest die Beträge so, wie sie auf dem Beleg stehen: in GBP
    vi.mocked(extraction.extractDocument).mockResolvedValueOnce({
      extraction: {
        lieferant: null,
        lieferantUstId: null,
        empfaenger: null,
        empfaengerUstId: null,
        rechnungsnummer: number,
        belegdatum: "2026-10-01",
        faelligAm: null,
        waehrung: "GBP",
        istGutschrift: false,
        betraege: [{ steuersatz: "19" as const, netto: "500.00", steuer: "95.00" }],
        brutto: "595.00",
        kategorie: "werbung" as const,
        hinweis: null,
      },
      fields: {
        supplierName: "",
        supplierUstId: "",
        invoiceNumber: number!,
        documentDate: "2026-10-01",
        dueDate: null,
        currency: "GBP",
        category: "werbung" as const,
        amounts: [{ taxRate: 1900 as const, net: 50_000, tax: 9_500 }],
        warnings: [],
      },
    });
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "gbp.jpg" });
    const { document } = (await documents.getDocument(id))!;
    expect(document.extractionError ?? "").toContain(`Die Rechnung ${number} hast du in Haben geschrieben.`);
    expect(document.category).toBeNull();
  });
});
