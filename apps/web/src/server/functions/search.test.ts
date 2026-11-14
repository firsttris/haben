import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Befehlspalette-Suche nach Rolle (Postgres)", () => {
  let search: typeof import("./search-query.ts");
  let contacts: typeof import("../modules/stammdaten/contacts.ts");
  let invoices: typeof import("../modules/rechnungen/invoices.ts");
  let quotes: typeof import("../modules/rechnungen/quotes.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    search = await import("./search-query.ts");
    contacts = await import("../modules/stammdaten/contacts.ts");
    invoices = await import("../modules/rechnungen/invoices.ts");
    quotes = await import("../modules/rechnungen/quotes.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate mail_log, quote_lines, quotes, quote_number_counters, document_amounts, documents, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 21)`;

    const kunde = await contacts.createContact(actor, {
      kundennummer: "K-7701",
      name: "Bergblick Software GmbH",
      strasse: "Alpenweg 2",
      plz: "80331",
      ort: "München",
      land: "DE",
      email: "hallo@bergblick.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: "zugferd",
    });

    const draftInvoice = await invoices.createDraft(actor, {
      contactId: kunde.id,
      issueDate: "2026-10-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Bergblick Beratung", quantity: 1000, unit: "Std.", unitPrice: 12000, taxRate: 1900 }],
    });

    const finalDraft = await invoices.createDraft(actor, {
      contactId: kunde.id,
      issueDate: "2026-10-06",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Bergblick Entwicklung", quantity: 1000, unit: "Std.", unitPrice: 15000, taxRate: 1900 }],
    });
    await invoices.finalizeInvoice(actor, finalDraft.id);

    const quoteDraft = await quotes.createQuoteDraft(actor, {
      contactId: kunde.id,
      issueDate: "2026-10-01",
      validUntil: "2026-10-31",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Bergblick Workshop", quantity: 1000, unit: "Std.", unitPrice: 9500, taxRate: 1900 }],
    });
    await quotes.finalizeQuote(actor, quoteDraft.id);

    // Beleg direkt anlegen: mit Lieferantenname, Belegnummer und Bruttobetrag 45,90 €
    await sql`insert into documents (supplier_name, invoice_number, filename, mime_type, size, sha256, document_date, category, gross, currency, status)
      values ('Bergblick Cloud AG', 'BLG-991', 'bergblick-oktober.pdf', 'application/pdf', 1234, 'deadbeef', '2026-10-04', 'software', 4590, 'EUR', 'gebucht')`;

    expect(draftInvoice.status).toBe("draft");
  });

  it("liefert unter 2 Zeichen eine leere Trefferliste", async () => {
    const res = await search.runCommandPaletteSearch(" B ", "inhaber");
    expect(res.contacts.hits).toHaveLength(0);
    expect(res.invoices.hits).toHaveLength(0);
    expect(res.quotes.hits).toHaveLength(0);
    expect(res.documents.hits).toHaveLength(0);
  });

  it("ignoriert überlange Zahlen oberhalb von int4 ohne Datenbankfehler", async () => {
    const res = await search.runCommandPaletteSearch("99999999", "inhaber");
    expect(res.documents.hits).toHaveLength(0);
  });

  it("findet für Inhaber Kontakte, Entwurf- und festgeschriebene Rechnungen, Angebote sowie Belege nach Text und Betrag", async () => {
    const textTreffer = await search.runCommandPaletteSearch("Bergblick", "inhaber");
    expect(textTreffer.contacts.hits.map((c) => c.kundennummer)).toEqual(["K-7701"]);
    expect(textTreffer.invoices.hits).toHaveLength(2);
    expect(textTreffer.invoices.hits.some((r) => r.status === "draft")).toBe(true);
    expect(textTreffer.invoices.hits.some((r) => r.status === "final")).toBe(true);
    expect(textTreffer.quotes.hits.map((q) => q.number)).toEqual(["AN-2026-001"]);
    expect(textTreffer.documents.hits.map((d) => d.invoiceNumber)).toEqual(["BLG-991"]);

    const rechnungsbetrag = await search.runCommandPaletteSearch("178,50", "inhaber");
    expect(rechnungsbetrag.invoices.hits.map((hit) => hit.gross)).toEqual([17850]);
    const angebotsbetrag = await search.runCommandPaletteSearch("113,05", "inhaber");
    expect(angebotsbetrag.quotes.hits.map((hit) => hit.gross)).toEqual([11305]);
    const entwurfsbetrag = await search.runCommandPaletteSearch("142,80", "steuerberatung");
    expect(entwurfsbetrag.invoices.hits).toEqual([]);

    const betragTreffer = await search.runCommandPaletteSearch("45,90", "inhaber");
    expect(betragTreffer.documents.hits.map((d) => d.supplierName)).toEqual(["Bergblick Cloud AG"]);
  });

  it("liefert für die Steuerberatung weder Kontakte noch Angebote noch Rechnungsentwürfe", async () => {
    const stbTreffer = await search.runCommandPaletteSearch("Bergblick", "steuerberatung");
    expect(stbTreffer.contacts.hits).toHaveLength(0);
    expect(stbTreffer.quotes.hits).toHaveLength(0);
    expect(stbTreffer.invoices.hits).toHaveLength(1);
    expect(stbTreffer.invoices.hits[0]?.status).toBe("final");
    expect(stbTreffer.documents.hits.map((d) => d.invoiceNumber)).toEqual(["BLG-991"]);
  });
  it("löst kürzlich angesehene Datensätze nur mit aktuellen Rechten auf", async () => {
    const owner = await search.runCommandPaletteSearch("Bergblick", "inhaber");
    const result = await search.resolveRecentPalette(
      [
        { type: "contact", id: owner.contacts.hits[0]!.id },
        { type: "quote", id: owner.quotes.hits[0]!.id },
        ...owner.invoices.hits.map(({ id }) => ({ type: "invoice" as const, id })),
        { type: "document", id: owner.documents.hits[0]!.id },
        { type: "document", id: "00000000-0000-4000-8000-000000000000" },
      ],
      "steuerberatung",
    );
    expect(result.contacts.hits).toEqual([]);
    expect(result.quotes.hits).toEqual([]);
    expect(result.invoices.hits.map(({ status }) => status)).toEqual(["final"]);
    expect(result.documents.hits).toEqual(owner.documents.hits);
  });

  it("nutzt bei 20.000 Belegen den Trigramm-Index für eine selektive Teilstringsuche", async () => {
    await sql`insert into documents (supplier_name, filename, mime_type, size, sha256)
      select 'Lieferant ' || i, 'beleg-' || i || '.pdf', 'application/pdf', 1, md5(i::text)
      from generate_series(1, 20000) i`;
    // Nach der Bulk-Befüllung die GIN-Pending-Listen leeren, wie es Autovacuum im Betrieb erledigt.
    await sql`vacuum analyze documents`;
    const plan = await sql`explain (format json) select id from documents
      where supplier_name ilike '%Bergblick%' or invoice_number ilike '%Bergblick%' or filename ilike '%Bergblick%'`;
    expect(JSON.stringify(plan)).toContain("documents_supplier_name_trgm_idx");
    const result = await search.runCommandPaletteSearch("Bergblick", "inhaber");
    expect(result.documents.hits).toHaveLength(1);
  });
});
