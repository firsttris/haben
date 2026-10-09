import { computeInvoiceTotals } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

// Die KI wird nicht aufgerufen; die Auslesung liefert feste Werte.
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return {
    ...original,
    extractionAvailable: () => true,
    extractDocument: vi.fn(async () => ({
      extraction: { quelle: "test" },
      fields: {
        supplierName: "Telekom Deutschland GmbH",
        supplierUstId: "DE123475223",
        invoiceNumber: "MF-2026-09",
        documentDate: "2026-09-29",
        dueDate: null,
        currency: "EUR",
        category: "telefon" as const,
        amounts: [{ taxRate: 1900 as const, net: 3857, tax: 733 }],
        warnings: [],
      },
    })),
  };
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

describe.skipIf(!testDatabaseUrl)("Belege (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let einvoice: typeof import("@haben/einvoice");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    einvoice = await import("@haben/einvoice");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  it("liest eine ZUGFeRD-Rechnung beim Hochladen aus", async () => {
    const lines = [{ description: "Server CX22", quantity: 1000, unit: "Monat" as const, unitPrice: 3240, taxRate: 1900 as const }];
    const sample: import("@haben/einvoice").InvoiceDocument = {
      kind: "rechnung",
      format: "zugferd",
      number: "R0018834512",
      issueDate: "2026-09-30",
      dueDate: "2026-10-14",
      paymentTermDays: 14,
      currency: "EUR",
      seller: {
        name: "Hetzner Online GmbH",
        strasse: "Industriestr. 25",
        plz: "91710",
        ort: "Gunzenhausen",
        land: "DE",
        email: "info@hetzner.example",
        telefon: "+49 9831 5050",
        ustId: "DE812871812",
        iban: "DE92760700120750007700",
      },
      buyer: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg", land: "DE", email: "a@b.example" },
      lines: lines.map((l, i) => ({ ...l, position: i + 1, net: l.unitPrice })),
      totals: computeInvoiceTotals(lines),
    };
    const { pdf } = await einvoice.buildEInvoice(sample);
    const { id, duplicate } = await documents.uploadDocument(actor, { bytes: pdf, filename: "rechnung.pdf" });
    expect(duplicate).toBe(false);

    const result = await documents.getDocument(id);
    expect(result?.document).toMatchObject({
      extractedBy: "zugferd",
      extractionStatus: "fertig",
      supplierName: sample.seller.name,
      invoiceNumber: sample.number,
      documentDate: sample.issueDate,
      gross: sample.totals.gross,
      category: null,
    });
    expect(result?.amounts.map((a) => [a.taxRate, a.net, a.tax])).toEqual(
      sample.totals.taxes.map((t) => [t.rate, t.base, t.tax]),
    );

    const again = await documents.uploadDocument(actor, { bytes: pdf, filename: "nochmal.pdf" });
    expect(again).toEqual({ id, duplicate: true });
  }, 30_000);

  it("Foto geht an die KI, Buchen erzeugt Aufwand und Vorsteuer und sperrt", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "quittung.jpg" });
    const before = (await documents.getDocument(id))!;
    expect(before.document).toMatchObject({ extractedBy: "ki", extractionStatus: "fertig", category: "telefon", gross: 4590 });
    expect(documents.bookingIssues(before.document, before.amounts)).toEqual([]);

    await documents.bookDocument(actor, id);
    const lines = await sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_id = ${id} order by l.debit desc`;
    expect(lines.map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual([
      ["4920", 3857, 0, "VSt19"],
      ["1576", 733, 0, "VSt19"],
      ["1600", 0, 4590, null],
    ]);

    await expect(sql`update documents set note = 'x' where id = ${id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from document_amounts where document_id = ${id}`).rejects.toThrow(/gebucht/);
    await expect(documents.deleteDocument(actor, id)).rejects.toThrow(/gebucht/);
    expect(await documents.inputTaxForPeriod({ year: 2026, month: 9 })).toBe(733);
    expect(await documents.inputTaxForPeriod({ year: 2026, month: 10 })).toBe(0);
  });

  it("merkt sich die Kategorie je Lieferant und bucht privat bezahlte Belege an Privateinlage", async () => {
    const first = await documents.uploadDocument(actor, { bytes: JPEG, filename: "a.jpg" });
    await documents.updateDocument(actor, first.id, {
      supplierName: "Telekom Deutschland GmbH",
      supplierUstId: "DE123475223",
      invoiceNumber: "MF-2026-09",
      documentDate: "2026-09-29",
      dueDate: null,
      category: "internet",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
    });
    await documents.bookDocument(actor, first.id);
    const [counter] = await sql`select l.account from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${first.id} and l.credit > 0`;
    expect(counter?.account).toBe("1890");

    const second = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 9]), filename: "b.jpg" });
    expect((await documents.getDocument(second.id))?.document.category).toBe("internet");
  });

  it("verlangt Pflichtangaben und erlaubt Löschen ungebuchter Belege", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "c.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "",
      supplierUstId: "",
      invoiceNumber: "",
      documentDate: null,
      dueDate: null,
      category: null,
      payment: "bank",
      note: "",
      amounts: [],
    });
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(/Lieferant fehlt, Belegdatum fehlt, Kategorie fehlt, Beträge fehlen/);
    await documents.deleteDocument(actor, id);
    expect(await documents.getDocument(id)).toBeNull();
  });

  it("Löschen lässt Dateien liegen, die das Archiv noch nutzt", async () => {
    const storage = await import("./storage.ts");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 1]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "x.jpg" });
    const sha = storage.sha256Of(bytes);
    await sql`insert into archive_files (kind, year, filename, sha256, mime_type, size) values ('kontoauszug', 2025, 'auszug.jpg', ${sha}, 'image/jpeg', 8)`;
    await documents.deleteDocument(actor, id);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);

    const other = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 2]);
    const second = await documents.uploadDocument(actor, { bytes: other, filename: "y.jpg" });
    await documents.deleteDocument(actor, second.id);
    await expect(storage.loadFile(storage.sha256Of(other))).rejects.toThrow();
  });

  it("Löschen lässt Dateien liegen, die ein Bescheid aus dem Postfach nutzt", async () => {
    const storage = await import("./storage.ts");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 3, 3, 3]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "bescheid.jpg" });
    const sha = storage.sha256Of(bytes);
    const [request] = await sql<{ id: string }[]>`
      insert into postfach_requests (art, test, ok, code, message, request_xml, response_xml, server_response_xml)
      values ('anfrage', true, true, 0, '', '', '', '') returning id`;
    await sql`
      insert into postfach_documents (referenz_id, bereitstellung_id, datenart, veranlagungszeitraum, steuernummer,
        bescheiddatum, dateibezeichnung, mime_type, filename, sha256, size, test, request_id)
      values ('r1', 'b1', 'ESt', '2025', '', '', '', 'image/jpeg', 'bescheid.jpg', ${sha}, 8, true, ${request!.id})`;
    await documents.deleteDocument(actor, id);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);
  });

  it("stellt eine beschädigte Datei beim erneuten Ablegen wieder her", async () => {
    const storage = await import("./storage.ts");
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 4, 4, 4]);
    const sha = await storage.storeFile(bytes);
    await writeFile(join(process.env.DOCUMENTS_DIR!, sha.slice(0, 2), sha), "");
    await expect(storage.loadFile(sha)).rejects.toThrow(/beschädigt/);
    await storage.storeFile(bytes);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);
  });

  it("gibt eine durch Neustart abgebrochene Auslesung wieder frei", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 5, 5]), filename: "z.jpg" });
    await sql`update documents set extraction_status = 'laeuft', supplier_name = '' where id = ${id}`;
    const detail = await documents.getDocument(id);
    expect(detail?.document).toMatchObject({ extractionStatus: "fehler", extractionError: expect.stringMatching(/unterbrochen/) });
    const [audit] = await sql`
      select actor from audit_log where table_name = 'documents' and row_id = ${id} and new_value->>'extraction_status' = 'fehler'`;
    expect(audit?.actor).toBe("system:auslesung");
  });

  it("lehnt unbekannte Dateitypen ab", async () => {
    await expect(
      documents.uploadDocument(actor, { bytes: new TextEncoder().encode("hallo"), filename: "x.txt" }),
    ).rejects.toThrow(/Erlaubt sind/);
  });
});
