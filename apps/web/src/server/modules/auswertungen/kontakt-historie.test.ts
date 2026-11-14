import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const PDF = new TextEncoder().encode("%PDF-1.4\n% Altbestand\n%%EOF\n");
const TODAY = "2026-11-11";

describe.skipIf(!testDatabaseUrl)("Rechnungen und Belege am Kontakt (Postgres)", () => {
  let history: typeof import("./kontakt-historie.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let legacy: typeof import("../archiv/legacy-open.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let kunde: string;
  let lieferant: string;
  /** Anderer Kontakt mit demselben Namen: zählt nie mit */
  let namensvetter: string;
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    history = await import("./kontakt-historie.ts");
    contacts = await import("../stammdaten/contacts.ts");
    invoices = await import("../rechnungen/invoices.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    legacy = await import("../archiv/legacy-open.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const contact = (name: string, role: { isCustomer: boolean; isSupplier: boolean }) =>
    contacts.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      ...role,
    } as Parameters<typeof contacts.createContact>[1]);

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_cancellations,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
    kunde = (await contact("Nordwerk Software GmbH", { isCustomer: true, isSupplier: false })).id;
    lieferant = (await contact("Bürobedarf Schmidt KG", { isCustomer: false, isSupplier: true })).id;
    namensvetter = (await contact("Nordwerk Software GmbH", { isCustomer: true, isSupplier: true })).id;
  });

  async function rechnung(contactId: string, issueDate: string, net: number, finalize = true) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return finalize ? invoices.finalizeInvoice(actor, draft.id) : draft;
  }

  async function beleg(supplierContactId: string, date: string, gross: number, book = true) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 9, 27]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    const net = Math.round(gross / 1.19);
    await documents.updateDocument(actor, id, {
      supplierName: "Bürobedarf Schmidt KG",
      supplierUstId: "",
      supplierContactId,
      invoiceNumber: `BS-${fileSeq}`,
      documentDate: date,
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      reverseCharge: null,
      asset: null,
      amounts: [{ taxRate: 1900, net, tax: gross - net }],
    } as Parameters<typeof documents.updateDocument>[2]);
    if (book) await documents.bookDocument(actor, id);
    return id;
  }

  async function altbeleg(values: {
    contactId: string | null;
    number: string;
    date: string;
    net: number;
    type?: string;
    direction?: "einnahme" | "ausgabe";
    source?: "lexoffice" | "sevdesk";
    lexofficeId?: string;
    raw?: Record<string, unknown>;
    open?: boolean;
  }) {
    const tax = Math.round(values.net * 0.19);
    const gross = values.net + tax;
    const payment = { status: values.open ? "openRevenue" : "balanced", openAmount: values.open ? gross : 0, paidDate: null, items: [] };
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, due_date, status,
        contact_id, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${values.lexofficeId ?? crypto.randomUUID()}, ${values.source ?? "lexoffice"}, (select id from lexoffice_imports limit 1),
        ${values.type ?? "invoice"}, ${values.direction ?? "einnahme"}, ${values.number}, ${values.date}, ${values.date}, ${values.open ? "open" : "paid"},
        ${values.contactId}, 'Nordwerk Software GmbH', ${values.net}, ${tax}, ${gross},
        ${JSON.stringify([{ rate: 1900, net: values.net, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb,
        ${JSON.stringify(values.raw ?? {})}::jsonb)
      returning id`;
    const sha = await storage.storeFile(PDF);
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
      values (${row!.id}, 'pdf', ${`${values.number}.pdf`}, 'application/pdf', ${sha}, ${PDF.byteLength})`;
    return row!.id as string;
  }

  // Jede festgeschriebene Rechnung erzeugt ihr PDF; wenige je Test, damit keiner unter Last an die 5 s stößt
  it("Kunde: festgeschriebene Rechnungen, Storno im Jahr des Stornos, ohne Entwurf", async () => {
    const dezember = await rechnung(kunde, "2025-12-01", 120_000);
    await invoices.cancelInvoice(actor, dezember.id, "2026-01-10");
    const maerz = await rechnung(kunde, "2026-03-02", 400_000);
    await rechnung(kunde, "2026-11-10", 99_900, false);

    const { sales, purchases } = await history.contactHistory(kunde, TODAY);
    expect(sales.years.map((y) => [y.year, y.count, y.net, y.gross])).toEqual([
      // März 4.000 €, Storno der Dezember-Rechnung −1.200 € im Jahr des Stornos
      [2026, 2, 280_000, 333_200],
      [2025, 1, 120_000, 142_800],
    ]);
    expect(sales.year).toBe(2026);
    expect(sales.rows.map((r) => [r.kind, r.date, r.net, r.kind === "rechnung" ? r.invoiceKind : null])).toEqual([
      ["rechnung", "2026-03-02", 400_000, "rechnung"],
      ["rechnung", "2026-01-10", -120_000, "storno"],
    ]);
    expect(sales.rows.find((r) => r.id === maerz.id)).toMatchObject({ kind: "rechnung", status: expect.any(String), archive: false });
    expect(purchases.years).toEqual([]);
    expect(purchases.rows).toEqual([]);
  });

  it("Kunde: eine Rechnungskorrektur mindert; Rechnungen eines Namensvetters zählen nicht", async () => {
    const maerz = await rechnung(kunde, "2026-03-02", 400_000);
    const korrektur = await invoices.createCorrection(actor, maerz.id, "2026-03-20");
    await invoices.finalizeInvoice(actor, korrektur.id);
    await rechnung(namensvetter, "2026-04-01", 77_700);

    const { sales } = await history.contactHistory(kunde, TODAY);
    expect(sales.years.map((y) => [y.year, y.count, y.net, y.gross])).toEqual([[2026, 2, 0, 0]]);
    expect(sales.rows.map((r) => [r.date, r.net, r.kind === "rechnung" ? r.invoiceKind : null])).toEqual([
      ["2026-03-20", -400_000, "korrektur"],
      ["2026-03-02", 400_000, "rechnung"],
    ]);
  });

  it("Kunde: ein gewähltes Jahr zeigt dessen Rechnungen, auch das Original eines späteren Stornos", async () => {
    const dezember = await rechnung(kunde, "2025-12-01", 120_000);
    const storno = await invoices.cancelInvoice(actor, dezember.id, "2026-01-10");
    const { sales } = await history.contactHistory(kunde, TODAY, 2025);
    expect(sales.year).toBe(2025);
    expect(sales.rows.map((r) => [r.id, r.kind === "rechnung" ? r.status : null])).toEqual([[dezember.id, "storniert"]]);
    // Die Auskunft unter dem Status nennt das Storno wie in der Rechnungsliste
    expect(sales.rows[0]).toMatchObject({ statusFacts: { listStatus: "storniert", cancelledBy: storno.number } });
    expect((await history.contactHistory(kunde, TODAY, 2019)).sales).toMatchObject({ year: 2019, rows: [] });
  });

  it("Lieferant: gebuchte Belege; ein stornierter steht da, zählt aber nicht; ungebuchte und fremde fehlen", async () => {
    await beleg(lieferant, "2026-02-12", 11_900);
    const falsch = await beleg(lieferant, "2026-05-20", 35_700);
    await cancellation.cancelDocument(actor, falsch, { reason: "Brutto als Netto erfasst" }, "2026-05-21");
    await beleg(lieferant, "2026-08-03", 23_800, false);
    await beleg(namensvetter, "2026-06-01", 5_950);

    const { sales, purchases } = await history.contactHistory(lieferant, TODAY);
    expect(sales.rows).toEqual([]);
    expect(purchases.years).toEqual([{ year: 2026, count: 1, net: 10_000, gross: 11_900, archiveNet: 0, archiveGross: 0 }]);
    expect(
      purchases.rows.map((r) => [r.kind, r.date, r.gross, r.counts, r.kind === "beleg" ? r.cancelledOn : null, r.kind === "beleg" ? r.category : null]),
    ).toEqual([
      ["beleg", "2026-05-20", 35_700, false, expect.any(String), "buero"],
      ["beleg", "2026-02-12", 11_900, true, null, "buero"],
    ]);
  });

  it("Altbestand: über die Kontakt-ID, mit Gutschrift; Richtung wie im Archiv", async () => {
    await altbeleg({ contactId: kunde, number: "RE-24001", date: "2024-05-02", net: 300_000 });
    await altbeleg({ contactId: kunde, number: "GU-24001", date: "2024-06-01", net: -50_000, type: "creditnote" });
    // Gleicher Name, aber ohne Kontakt-ID: zählt nicht
    await altbeleg({ contactId: null, number: "RE-24002", date: "2024-07-01", net: 999_900 });
    await altbeleg({ contactId: namensvetter, number: "RE-24003", date: "2024-08-01", net: 888_800 });
    // sevDesk-Beleg mit „C“: Ausgabe, auch wenn ein früherer Abruf ihn als Einnahme gespeichert hat (#472)
    await altbeleg({
      contactId: kunde,
      number: "B-24001",
      date: "2024-09-01",
      net: 10_000,
      source: "sevdesk",
      lexofficeId: "voucher/1",
      raw: { creditDebit: "C" },
    });
    const rechnungHeute = await rechnung(kunde, "2026-03-02", 400_000);

    const { sales, purchases } = await history.contactHistory(kunde, TODAY, 2024);
    expect(sales.years.map((y) => [y.year, y.count, y.net, y.archiveNet])).toEqual([
      [2026, 1, 400_000, 0],
      [2024, 2, 250_000, 250_000],
    ]);
    expect(sales.rows.map((r) => [r.kind, r.number, r.net, r.archive, r.kind === "archiv" ? [r.type, r.source] : null])).toEqual([
      ["archiv", "GU-24001", -50_000, true, ["creditnote", "lexoffice"]],
      ["archiv", "RE-24001", 300_000, true, ["invoice", "lexoffice"]],
    ]);
    expect(purchases.rows.map((r) => [r.kind, r.number, r.kind === "archiv" ? r.type : null])).toEqual([["archiv", "B-24001", "purchaseinvoice"]]);
    expect((await history.contactHistory(kunde, TODAY)).sales.rows.map((r) => r.id)).toEqual([rechnungHeute.id]);
  });

  it("Altbestand: ein übernommener offener Posten steht nur einmal da, als Rechnung in Haben", async () => {
    const id = await altbeleg({ contactId: kunde, number: "RE-25019", date: "2025-09-20", net: 400_000, open: true });
    const result = await legacy.takeOverLegacyItem(actor, id);
    expect(result.kind).toBe("invoice");

    const { sales } = await history.contactHistory(kunde, TODAY, 2025);
    expect(sales.years.map((y) => [y.year, y.count, y.net, y.archiveNet])).toEqual([[2025, 1, 400_000, 0]]);
    expect(sales.rows.map((r) => [r.kind, r.id, r.number])).toEqual([["rechnung", result.id, "RE-25019"]]);
  });

  // Die Übernahme legt den Beleg ohne Lieferant aus den Kontakten an; er gehört über den archivierten Beleg zum Kontakt
  it("Altbestand: ein als Beleg übernommener offener Posten steht beim Lieferanten einmal da, als Beleg in Haben", async () => {
    const id = await altbeleg({
      contactId: lieferant,
      number: "B-25019",
      date: "2025-09-20",
      net: 10_000,
      type: "purchaseinvoice",
      direction: "ausgabe",
      open: true,
    });
    const result = await legacy.takeOverLegacyItem(actor, id);
    expect(result.kind).toBe("document");

    const { purchases } = await history.contactHistory(lieferant, TODAY, 2025);
    expect(purchases.years.map((y) => [y.year, y.count, y.net, y.archiveNet])).toEqual([[2025, 1, 10_000, 0]]);
    expect(purchases.rows.map((r) => [r.kind, r.id, r.number])).toEqual([["beleg", result.id, "B-25019"]]);
  });
});
