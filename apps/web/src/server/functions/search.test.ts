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
      where haben_unaccent(supplier_name) ilike haben_unaccent('%Bergblick%')
         or haben_unaccent(invoice_number) ilike haben_unaccent('%Bergblick%')
         or haben_unaccent(filename) ilike haben_unaccent('%Bergblick%')`;
    expect(JSON.stringify(plan)).toContain("documents_supplier_name_trgm_idx");
    const result = await search.runCommandPaletteSearch("Bergblick", "inhaber");
    expect(result.documents.hits).toHaveLength(1);
  }, 15000);

  it("findet Umlaute ohne Akzent (Muller -> Müller) und nutzt weiter den Trigramm-Index", async () => {
    await sql`insert into contacts (name, kundennummer, is_customer, ort) values ('Müller & Söhne GmbH', 'K-9001', true, 'München')`;
    const treffer = await search.runCommandPaletteSearch("Muller", "inhaber");
    expect(treffer.contacts.hits.some((c) => c.kundennummer === "K-9001")).toBe(true);

    await sql`insert into contacts (name, kundennummer, is_customer)
      select 'Kontakt ' || i, 'K-' || (10000 + i), true from generate_series(1, 5000) i`;
    await sql`vacuum analyze contacts`;
    const plan = await sql`explain (format json) select id from contacts where haben_unaccent(name) ilike haben_unaccent('%Muller%')`;
    expect(JSON.stringify(plan)).toContain("contacts_name_trgm_idx");
  }, 15000);

  it("findet Belege und Rechnungen über das Datum (14.11.2026)", async () => {
    await sql`insert into documents (supplier_name, invoice_number, filename, mime_type, size, sha256, document_date)
      values ('Datums-Lieferant', 'DT-1', 'dt.pdf', 'application/pdf', 1, 'abc123456', '2026-11-14')`;
    const treffer = await search.runCommandPaletteSearch("14.11.2026", "inhaber");
    expect(treffer.documents.hits.some((d) => d.invoiceNumber === "DT-1")).toBe(true);
  });

  it("durchsucht Bankumsätze (±Betrag, IBAN-Ende) und verbirgt sie vor der Steuerberatung", async () => {
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'csv.csv', 'sha-bank-1', 'csv', 1, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, counterparty_iban, purpose, dedup_hash)
      values (${ba!.id}, ${bi!.id}, '2026-11-14', -123456, 'Cloud Hosting GmbH', 'DE11223344556677889900', 'Rechnung 42', 'dedup-1')`;

    const betragTreffer = await search.runCommandPaletteSearch("1.234,56", "inhaber");
    expect(betragTreffer.bankTransactions.hits.map((t) => t.counterpartyName)).toEqual(["Cloud Hosting GmbH"]);
    expect(betragTreffer.bankTransactions.hits[0]?.ibanLast4).toBe("9900");

    const ibanTreffer = await search.runCommandPaletteSearch("9900", "inhaber");
    expect(ibanTreffer.bankTransactions.hits).toHaveLength(1);

    const stbTreffer = await search.runCommandPaletteSearch("Cloud Hosting", "steuerberatung");
    expect(stbTreffer.bankTransactions.hits).toEqual([]);
  });

  it("findet Buchungen und Sachkonten für Inhaber und Steuerberatung", async () => {
    await sql.begin(async (tx) => {
      const [je] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-11-14', 'Büromaterial Einkauf', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${je!.id}, '4930', 5000, 0), (${je!.id}, '1200', 0, 5000)`;
      await tx`update journal_entries set locked_at = now() where id = ${je!.id}`;
    });

    const stbBuchung = await search.runCommandPaletteSearch("Büromaterial", "steuerberatung");
    expect(stbBuchung.bookings.hits.map((b) => b.description)).toEqual(["Büromaterial Einkauf"]);

    const stbKonto = await search.runCommandPaletteSearch("4930", "steuerberatung");
    expect(stbKonto.accounts.hits.some((a) => a.account === "4930")).toBe(true);
  });

  it("durchsucht bei Mitarbeitern nur Name und Personalnummer, nie Steuer-ID, SV-Nummer, IBAN oder Geburtsdatum", async () => {
    await sql`insert into employees (personalnummer, vorname, nachname, geburtsdatum, steuer_id, sv_nummer, art, monatsgehalt, eintritt, iban)
      values (42, 'Erika', 'Mustermann', '1988-05-12', '12345678901', '65120588M001', 'vollzeit', 450000, '2026-01-01', 'DE02120300000000202051')`;

    expect((await search.runCommandPaletteSearch("Mustermann", "inhaber")).employees.hits).toHaveLength(1);
    expect((await search.runCommandPaletteSearch("42", "inhaber")).employees.hits).toHaveLength(1);
    expect((await search.runCommandPaletteSearch("12345678901", "inhaber")).employees.hits).toHaveLength(0);
    expect((await search.runCommandPaletteSearch("65120588M001", "inhaber")).employees.hits).toHaveLength(0);
    expect((await search.runCommandPaletteSearch("202051", "inhaber")).employees.hits).toHaveLength(0);
    expect((await search.runCommandPaletteSearch("12.05.1988", "inhaber")).employees.hits).toHaveLength(0);
  });

  it("durchsucht das Umzugsarchiv standardmäßig und blendet es bei ausgeschalteter Einstellung aus", async () => {
    const [imp] = await sql`insert into lexoffice_imports (source, status, progress) values ('lexoffice', 'fertig', '{}') returning id`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, raw)
      values ('lex-1', 'lexoffice', ${imp!.id}, 'purchaseinvoice', 'ausgabe', 'ALT-2024-99', '2024-06-01', 'paid', 'Altlieferant GmbH', 1000, 190, 1190, '[]', '[]', '{}')`;

    const an = await search.runCommandPaletteSearch("Altlieferant", "inhaber");
    expect(an.archive.hits.map((a) => a.number)).toEqual(["ALT-2024-99"]);

    await sql`update company set archive_search = false where id = 1`;
    const aus = await search.runCommandPaletteSearch("Altlieferant", "inhaber");
    expect(aus.archive.hits).toEqual([]);
  });
});
