import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

/*
 * Beleg duplizieren (#1295): ein neuer Entwurf mit neuer Datei und der Kontierung eines vorhandenen Belegs, Datum heute;
 * Datei, Zahlungen und Festschreibung bleiben beim Original. Alle Daten sind erfunden.
 */

// Die KI liefert feste Werte; ein Duplikat ruft sie nicht auf
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return {
    ...original,
    extractionAvailable: () => true,
    extractDocument: vi.fn(async () => ({
      extraction: { quelle: "test" },
      fields: {
        supplierName: "KI",
        supplierUstId: "",
        invoiceNumber: "",
        documentDate: null,
        dueDate: null,
        currency: "EUR",
        category: null,
        amounts: [],
        warnings: [],
      },
    })),
  };
});

// Gegenkonto der Belegbuchung: privat bezahlt an Privateinlagen (SKR03), über die Bank an Verbindlichkeiten (SKR04)
const KONTEN = { SKR03: { privat: "1890" }, SKR04: { verbindlichkeiten: "3300" } } as const;

describe.skipIf(!testDatabaseUrl)("Beleg duplizieren (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let duplizieren: typeof import("./duplizieren.ts");
  let extraction: typeof import("./extraction.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    duplizieren = await import("./duplizieren.ts");
    extraction = await import("./extraction.ts");
    stammdaten = await import("../stammdaten/index.ts");
    konten = await import("../eigene-konten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_splits, document_amounts, documents, own_accounts, exchange_rates,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen) values (1, 'Testfirma', ${versteuerung}, ${kontenrahmen})`;
  }

  /** Eine neue Datei je Aufruf, damit Haben sie nicht als schon vorhanden erkennt */
  function jpeg(): { bytes: Uint8Array; filename: string } {
    fileSeq++;
    return {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 95]),
      filename: `quittung-${fileSeq}.jpg`,
    };
  }

  const lieferant = {
    kundennummer: "",
    name: "Bürohaus Lindner GmbH",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "DE287654321",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    isCustomer: false,
    isSupplier: true,
  };

  it("übernimmt Lieferant, Kategorie, Bezahlung und Beträge eines gebuchten Belegs, mit neuer Datei und Datum heute", async () => {
    await reset("SKR03", "ist");
    const kontakt = await stammdaten.createContact(actor, lieferant);
    const datei = jpeg();
    const { id } = await documents.uploadDocument(actor, datei);
    await documents.updateDocument(actor, id, {
      supplierName: "Bürohaus Lindner GmbH",
      supplierUstId: "DE287654321",
      supplierContactId: kontakt.id,
      invoiceNumber: "BL-2026-1104",
      documentDate: "2026-11-04",
      dueDate: "2026-11-18",
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      category: "buero",
      payment: "privat",
      note: "Kopierpapier und Toner",
      amounts: [
        { taxRate: 1900, net: 4_200, tax: 798 },
        { taxRate: 700, net: 1_000, tax: 70 },
      ],
    });
    await documents.bookDocument(actor, id);
    const kiAufrufe = vi.mocked(extraction.extractDocument).mock.calls.length;

    const neu = jpeg();
    const result = await duplizieren.duplicateDocument(actor, id, neu);
    expect(result.duplicate).toBe(false);
    const copy = (await documents.getDocument(result.id))!;
    const [original] = await sql`select sha256, status, invoice_number from documents where id = ${id}`;
    expect(copy.document).toMatchObject({
      status: "neu",
      lockedAt: null,
      filename: neu.filename,
      supplierName: "Bürohaus Lindner GmbH",
      supplierUstId: "DE287654321",
      supplierContactId: kontakt.id,
      invoiceNumber: "",
      documentDate: today(),
      dueDate: null,
      serviceFrom: null,
      serviceTo: null,
      category: "buero",
      payment: "privat",
      note: "",
      vorsteuerAnteil: null,
      extractedBy: null,
      extractionStatus: "keine",
      net: 5_200,
      tax: 868,
      gross: 6_068,
    });
    expect(copy.document.sha256).not.toBe(original!.sha256);
    expect(copy.amounts.map(({ taxRate, net, tax }) => [taxRate, net, tax])).toEqual([
      [1900, 4_200, 798],
      [700, 1_000, 70],
    ]);
    // Nicht ausgelesen, das Original bleibt gebucht
    expect(vi.mocked(extraction.extractDocument).mock.calls.length).toBe(kiAufrufe);
    expect(original).toMatchObject({ status: "gebucht", invoice_number: "BL-2026-1104" });

    // Dieselbe Datei legt keinen zweiten Entwurf an, die des Originals auch nicht
    expect(await duplizieren.duplicateDocument(actor, id, neu)).toEqual({ id: result.id, duplicate: true });
    expect(await duplizieren.duplicateDocument(actor, id, datei)).toEqual({ id, duplicate: true });

    // Bereit zum Buchen; privat bezahlt an Privateinlage
    expect(documents.bookingIssues(copy.document, copy.amounts)).toEqual([]);
    await documents.bookDocument(actor, result.id);
    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${result.id} and e.date = ${today()}`;
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(6_068);
    expect(lines.filter((l) => l.credit > 0).map((l) => [l.account, l.credit])).toEqual([[KONTEN.SKR03.privat, 6_068]]);
  });

  it("übernimmt Aufteilung und Teilabzug; was heute nicht mehr wählbar ist, fällt weg", async () => {
    await reset("SKR04", "soll");
    const kontakt = await stammdaten.createContact(actor, lieferant);
    const eigenes = await konten.createOwnAccount(actor, { account: "6999", name: "Software: Entwicklung", parentCategory: "software" });
    const { id } = await documents.uploadDocument(actor, jpeg());
    await documents.updateDocument(actor, id, {
      supplierName: "Bürohaus Lindner GmbH",
      supplierUstId: "DE287654321",
      supplierContactId: kontakt.id,
      invoiceNumber: "BL-2026-1105",
      documentDate: "2026-11-05",
      dueDate: null,
      category: null,
      payment: "bank",
      note: "",
      vorsteuerAnteil: 5_000,
      amounts: [{ taxRate: 1900, net: 7_000, tax: 1_330 }],
      splits: [
        { category: "software", ownAccountId: eigenes, taxRate: 1900, net: 5_000 },
        { category: "buero", taxRate: 1900, net: 2_000 },
      ],
    });
    // Danach archiviert bzw. nur noch Kunde: an einem neuen Beleg ließe sich beides nicht mehr wählen
    await konten.setOwnAccountArchived(actor, eigenes, true);
    await stammdaten.updateContact(actor, kontakt.id, { ...lieferant, isCustomer: true, isSupplier: false });

    const { id: copyId } = await duplizieren.duplicateDocument(actor, id, jpeg());
    const copy = (await documents.getDocument(copyId))!;
    expect(copy.document).toMatchObject({
      supplierName: "Bürohaus Lindner GmbH",
      supplierContactId: null,
      category: null,
      payment: "bank",
      vorsteuerAnteil: 5_000,
      documentDate: today(),
    });
    expect(copy.splits.map(({ category, ownAccountId, taxRate, net, tax }) => ({ category, ownAccountId, taxRate, net, tax }))).toEqual([
      { category: "software", ownAccountId: null, taxRate: 1900, net: 5_000, tax: 950 },
      { category: "buero", ownAccountId: null, taxRate: 1900, net: 2_000, tax: 380 },
    ]);
    expect(documents.bookingIssues(copy.document, copy.amounts, today(), copy.splits)).toEqual([]);
    await documents.bookDocument(actor, copyId);
    const [bank] = await sql`select l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${copyId} and l.account = ${KONTEN.SKR04.verbindlichkeiten}`;
    expect(bank!.credit).toBe(8_330);
  });

  it("rechnet eine Fremdwährung mit dem Kurs des heutigen Monats um; archivierter Kontakt, Auslesung und unbekannter Beleg", async () => {
    await reset("SKR03", "soll");
    const figma = await stammdaten.createContact(actor, { ...lieferant, name: "Figma Inc.", land: "US", ustId: "" });
    const { id } = await documents.uploadDocument(actor, jpeg());
    await documents.updateDocument(actor, id, {
      supplierName: "Figma Inc.",
      supplierUstId: "",
      supplierContactId: figma.id,
      invoiceNumber: "F-1001",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      currency: "USD",
      exchangeRate: "1,0812",
      reverseCharge: "drittland",
      amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 10_000, originalTax: 0 }],
    });
    await sql`insert into exchange_rates (currency, month, rate, source) values ('USD', ${today().slice(0, 7)}, '1.2500', 'bmf')`;
    // Archiviert: in der Auswahl am Beleg nicht mehr zu finden (listContactChoices)
    await stammdaten.setContactArchived(actor, figma.id, true);

    const { id: copyId } = await duplizieren.duplicateDocument(actor, id, jpeg());
    const copy = (await documents.getDocument(copyId))!;
    // 100,00 USD / 1,25 = 80,00 €; § 13b: 19 % selbst berechnet
    expect(copy.document).toMatchObject({
      supplierName: "Figma Inc.",
      supplierContactId: null,
      currency: "USD",
      reverseCharge: "drittland",
      exchangeRate: "1.250000",
      exchangeRateSource: "ust",
      net: 8_000,
    });
    expect(copy.amounts.map((a) => [a.taxRate, a.net, a.tax, a.originalNet])).toEqual([[1900, 8_000, 1_520, 10_000]]);

    // Solange die KI ausliest, stehen die Felder noch nicht fest
    await sql`update documents set extraction_status = 'laeuft' where id = ${copyId}`;
    await expect(duplizieren.duplicateDocument(actor, copyId, jpeg())).rejects.toThrow(/gerade ausgelesen/);
    await expect(duplizieren.duplicateDocument(actor, "00000000-0000-4000-8000-000000000000", jpeg())).rejects.toThrow(/nicht gefunden/);
  });
});
