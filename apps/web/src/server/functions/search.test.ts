import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { kleinunternehmerStand } from "../modules/auswertungen/test-umsatz-stand.ts";

describe.skipIf(!testDatabaseUrl)("Befehlspalette-Suche nach Rolle (Postgres)", () => {
  let search: typeof import("./search-query.ts");
  let contacts: typeof import("../modules/stammdaten/contacts.ts");
  let invoices: typeof import("../modules/rechnungen/index.ts");
  let quotes: typeof import("../modules/rechnungen/quotes.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    search = await import("./search-query.ts");
    contacts = await import("../modules/stammdaten/contacts.ts");
    invoices = await import("../modules/rechnungen/index.ts");
    quotes = await import("../modules/rechnungen/quotes.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate mail_log, quote_lines, quotes, quote_number_counters, document_amounts, documents, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, allocations, bank_transactions, bank_imports, bank_accounts, loans, vat_returns, zm_submissions, pauschalen, cash_entries, company cascade`;
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
    await invoices.finalizeInvoice(actor, finalDraft.id, kleinunternehmerStand);

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

  it("sucht Beträge an der Grenze von int4 mit beiden Vorzeichen ohne Datenbankfehler", async () => {
    for (const betrag of ["-21474836,48", "21474836,48", "21474836,47", "-21474836,47"]) {
      const res = await search.runCommandPaletteSearch(betrag, "inhaber");
      expect(res.bankTransactions.hits).toEqual([]);
      expect(res.bookings.hits).toEqual([]);
    }
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
      values (42, 'Erika', 'Mustermann', '1988-05-12', '12345678901', '65120588M001', 'beschaeftigt', 450000, '2026-01-01', 'DE02120300000000202051')`;

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
  it("liefert der Steuerberatung aus Stufe 2 nur Buchungen und Konten", async () => {
    await sql`insert into employees (personalnummer, vorname, nachname, geburtsdatum, steuer_id, sv_nummer, art, monatsgehalt, eintritt, iban)
      values (77, 'Berta', 'Bergblick', '1990-01-01', '98765432109', '65010190B002', 'beschaeftigt', 300000, '2026-01-01', 'DE02120300000000202051')`;
    await sql`insert into articles (number, description, unit, unit_price, tax_rate) values ('ART-1', 'Bergblick Lizenz', 'Stk.', 1000, 1900)`;
    const stb = await search.runCommandPaletteSearch("Bergblick", "steuerberatung");
    const erlaubt = new Set(["invoices", "documents", "bookings", "accounts"]);
    for (const [gruppe, ergebnis] of Object.entries(stb)) {
      if (!erlaubt.has(gruppe)) expect({ gruppe, hits: ergebnis.hits }).toEqual({ gruppe, hits: [] });
    }
    const inhaber = await search.runCommandPaletteSearch("Bergblick", "inhaber");
    expect(inhaber.employees.hits).toHaveLength(1);
    expect(inhaber.articles.hits).toHaveLength(1);
  });

  it("nennt bei einem Bankumsatz das Konto, damit die Palette ihn im richtigen Konto öffnet", async () => {
    await sql`insert into bank_accounts (name, iban, purpose) values ('Erstkonto', 'DE89370400440532013000', 'geschaeft')`;
    const [zweit] = await sql`insert into bank_accounts (name, iban, purpose) values ('Zweitkonto', 'DE02120300000000202051', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${zweit!.id}, 'zweit.csv', 'sha-zweit', 'csv', 1, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${zweit!.id}, ${bi!.id}, '2026-11-14', -4200, 'Zweitkonto Lieferant', 'Miete', 'dedup-zweit')`;
    const treffer = await search.runCommandPaletteSearch("Zweitkonto Lieferant", "inhaber");
    expect(treffer.bankTransactions.hits[0]).toMatchObject({ bankAccountId: zweit!.id });
  });

  it("schaltet die Archivsuche mit Audit-Eintrag aus", async () => {
    const { setArchiveSearch } = await import("../modules/stammdaten/index.ts");
    await setArchiveSearch(actor, false);
    const [company] = await sql`select archive_search from company where id = 1`;
    expect(company!.archive_search).toBe(false);
    const [audit] = await sql`select actor, new_value from audit_log where table_name = 'company' order by seq desc limit 1`;
    expect(audit!.actor).toBe(actor);
    expect(audit!.new_value).toMatchObject({ archive_search: false });
  });

  it("liest bei einer Betragssuche in 20.000 Buchungen nicht alle Buchungszeilen", async () => {
    await sql.begin(async (tx) => {
      await tx`insert into journal_entries (id, date, description, source_type, source_id, kontenrahmen)
        select md5('jb' || i)::uuid, date '2020-01-01' + (i % 2000), 'Buchung ' || md5(i::text), 'manuell', gen_random_uuid(), 'SKR03'
        from generate_series(1, 20000) i`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        select md5('jb' || i)::uuid, a.account, case when a.debit > 0 then a.debit + i else 0 end, case when a.credit > 0 then a.credit + i else 0 end
        from generate_series(1, 20000) i, (values ('4930', 5000, 0), ('1200', 0, 5000)) a(account, debit, credit)`;
      await tx`update journal_entries set locked_at = now() where locked_at is null`;
    });
    await sql`vacuum analyze journal_entries`;
    await sql`vacuum analyze journal_lines`;
    const { bookingEntriesQuery } = await import("../modules/buchhaltung/search.ts");
    // Mit Cent genau, mit ganzem Euro als Bereich (between): beide über die Indizes auf Soll und Haben
    for (const betrag of ["123,45", "1190"]) {
      const { select } = await bookingEntriesQuery(betrag, 5);
      const query = select.toSQL();
      const [row] = await sql.unsafe(`explain (format json) ${query.sql}`, query.params as never[]);
      type Knoten = { "Node Type": string; "Relation Name"?: string; Plans?: Knoten[] };
      const knoten = (k: Knoten): Knoten[] => [k, ...(k.Plans ?? []).flatMap(knoten)];
      const alle = knoten((row as unknown as { "QUERY PLAN": { Plan: Knoten }[] })["QUERY PLAN"][0]!.Plan);
      expect({ betrag, seqScans: alle.filter((k) => k["Node Type"] === "Seq Scan").map((k) => k["Relation Name"]) }).toEqual({ betrag, seqScans: [] });
    }
  }, 60_000);

  it("nutzt bei 100.000 Bankumsätzen die Trigramm-Indizes", async () => {
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'massen.csv', 'sha-massen', 'csv', 100000, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, counterparty_iban, purpose, dedup_hash)
      select ${ba!.id}, ${bi!.id}, date '2020-01-01' + (i % 2000), i - 50000, 'Gegenseite ' || (i % 5000),
        'DE' || lpad(i::text, 20, '0'), 'Verwendung ' || md5(i::text), 'massen-' || i
      from generate_series(1, 100000) i`;
    await sql`vacuum analyze bank_transactions`;
    const plan = await sql`explain (format json) select id from bank_transactions
      where haben_unaccent(counterparty_name) ilike haben_unaccent('%Hosting%')
         or haben_unaccent(purpose) ilike haben_unaccent('%Hosting%')
         or haben_unaccent(counterparty_iban) ilike haben_unaccent('%Hosting%')
      order by booking_date desc, created_at desc limit 6`;
    expect(JSON.stringify(plan)).toContain("bank_transactions_counterparty_name_trgm_idx");
    expect(JSON.stringify(plan)).toContain("bank_transactions_purpose_trgm_idx");
  }, 60_000);

  it("nutzt bei 20.000 Buchungen den Trigramm-Index des Buchungstexts statt alle Buchungszeilen zu lesen", async () => {
    await sql.begin(async (tx) => {
      await tx`insert into journal_entries (id, date, description, source_type, source_id, kontenrahmen)
        select md5('je' || i)::uuid, date '2020-01-01' + (i % 2000), 'Buchung ' || md5(i::text), 'manuell', gen_random_uuid(), 'SKR03'
        from generate_series(1, 20000) i`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        select md5('je' || i)::uuid, a.account, a.debit, a.credit
        from generate_series(1, 20000) i, (values ('4930', 5000, 0), ('1200', 0, 5000)) a(account, debit, credit)`;
      await tx`update journal_entries set locked_at = now() where locked_at is null`;
    });
    await sql`vacuum analyze journal_entries`;
    await sql`vacuum analyze journal_lines`;
    const { bookingEntriesQuery } = await import("../modules/buchhaltung/search.ts");
    const { select } = await bookingEntriesQuery("Hosting", 5);
    const query = select.toSQL();
    const [row] = await sql.unsafe(`explain (format json) ${query.sql}`, query.params as never[]);
    type Knoten = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: Knoten[] };
    const knoten = (k: Knoten): Knoten[] => [k, ...(k.Plans ?? []).flatMap(knoten)];
    const alle = knoten((row as unknown as { "QUERY PLAN": { Plan: Knoten }[] })["QUERY PLAN"][0]!.Plan);
    expect(alle.map((k) => k["Index Name"])).toContain("journal_entries_description_trgm_idx");
    expect(alle.filter((k) => k["Node Type"] === "Seq Scan").map((k) => k["Relation Name"])).toEqual([]);
  }, 60_000);

  it("findet mit dem Betrag 0,00 keine Buchung über die leere Seite ihrer Zeilen", async () => {
    await sql.begin(async (tx) => {
      const [je] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-11-14', 'Miete November', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${je!.id}, '4210', 5000, 0), (${je!.id}, '1200', 0, 5000)`;
      await tx`update journal_entries set locked_at = now() where id = ${je!.id}`;
    });
    expect((await search.runCommandPaletteSearch("50,00", "inhaber")).bookings.hits.map((b) => b.description)).toEqual(["Miete November"]);
    expect((await search.runCommandPaletteSearch("0,00", "inhaber")).bookings.hits).toEqual([]);
  });

  it("zeigt bei Darlehen die aktuelle Restschuld wie die Seite Darlehen", async () => {
    const bank = await import("../modules/bank/index.ts");
    const [loan] = await sql`insert into loans (name, lender, term, purpose, opening_balance)
      values ('Bergblick Kredit', 'bank', 'ueber5', 'betrieb', 0) returning id`;
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'k.csv', 'sha-kredit', 'csv', 1, 0) returning id`;
    const [tx] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${ba!.id}, ${bi!.id}, '2026-02-01', 1000000, 'Bank', 'Auszahlung', 'kredit-1') returning id`;
    // Nur die Zuordnung, ohne die Buchung, die der Weg über das Hauptbuch dazu anlegt; die Restschuld liest nur sie
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`insert into allocations (transaction_id, kind, amount, loan_id, loan_part) values (${tx!.id}, 'darlehen', 1000000, ${loan!.id}, 'auszahlung')`;
    });
    const [seite] = (await bank.listLoans()).filter((l) => l.id === loan!.id);
    expect(seite!.balance).toBe(1000000);
    const treffer = await search.runCommandPaletteSearch("Bergblick Kredit", "inhaber");
    expect(treffer.loans.hits.map((l) => l.balance)).toEqual([1000000]);
  });

  it("nennt einen teilweise zugeordneten Bankumsatz offen wie der Filter auf der Bankseite", async () => {
    const [loan] = await sql`insert into loans (name, lender, term, purpose, opening_balance)
      values ('Teilkredit', 'bank', 'ueber5', 'betrieb', 1000000) returning id`;
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 't.csv', 'sha-teil', 'csv', 2, 0) returning id`;
    const [teil, ganz] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${ba!.id}, ${bi!.id}, '2026-10-01', -250000, 'Teilbank AG', 'Rate Oktober', 'teil-1'),
             (${ba!.id}, ${bi!.id}, '2026-11-01', -200000, 'Teilbank AG', 'Rate November', 'teil-2') returning id`;
    // Nur die Zuordnungen, ohne die Buchungen des Hauptbuchs; der offene Betrag liest nur sie
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`insert into allocations (transaction_id, kind, amount, loan_id, loan_part)
        values (${teil!.id}, 'darlehen', -200000, ${loan!.id}, 'tilgung'), (${ganz!.id}, 'darlehen', -200000, ${loan!.id}, 'tilgung')`;
    });
    const treffer = await search.runCommandPaletteSearch("Teilbank", "inhaber");
    expect(Object.fromEntries(treffer.bankTransactions.hits.map((t) => [t.purpose, [t.hint, t.open]]))).toEqual({
      "Rate Oktober": ["teilweise", -50000],
      "Rate November": ["zugeordnet", 0],
    });
  });

  it("findet mit ganzem Euro alle Cent-Beträge dieses Euros, mit Cent genau, beim Bankumsatz mit beiden Vorzeichen", async () => {
    await sql`insert into documents (supplier_name, invoice_number, filename, mime_type, size, sha256, gross)
      values ('Euro-Lieferant', 'EU-1', 'eu1.pdf', 'application/pdf', 1, 'eu-1', 119000), ('Euro-Lieferant', 'EU-2', 'eu2.pdf', 'application/pdf', 1, 'eu-2', 119047),
             ('Euro-Lieferant', 'EU-3', 'eu3.pdf', 'application/pdf', 1, 'eu-3', 119100), ('Euro-Lieferant', 'EU-4', 'eu4.pdf', 'application/pdf', 1, 'eu-4', 118999)`;
    const nummern = async (q: string) => (await search.runCommandPaletteSearch(q, "inhaber")).documents.hits.map((d) => d.invoiceNumber).sort();
    expect(await nummern("1190")).toEqual(["EU-1", "EU-2"]);
    expect(await nummern("1.190 €")).toEqual(["EU-1", "EU-2"]);
    expect(await nummern("1190,47")).toEqual(["EU-2"]);

    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'e.csv', 'sha-euro', 'csv', 3, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${ba!.id}, ${bi!.id}, '2026-10-01', -119047, 'A', 'minus', 'eu-b1'), (${ba!.id}, ${bi!.id}, '2026-10-02', 119099, 'B', 'plus', 'eu-b2'),
             (${ba!.id}, ${bi!.id}, '2026-10-03', -119100, 'C', 'daneben', 'eu-b3')`;
    const zwecke = async (q: string) => (await search.runCommandPaletteSearch(q, "inhaber")).bankTransactions.hits.map((t) => t.purpose).sort();
    expect(await zwecke("1190")).toEqual(["minus", "plus"]);
    expect(await zwecke("-1190")).toEqual(["minus", "plus"]);
  });

  it("nutzt für einen Betragsbereich bei 100.000 Bankumsätzen den Index auf dem Betrag", async () => {
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'r.csv', 'sha-bereich', 'csv', 100000, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      select ${ba!.id}, ${bi!.id}, date '2020-01-01' + (i % 2000), i * 37 - 1850000, 'Gegenseite ' || i, 'Zweck ' || md5(i::text), 'bereich-' || i
      from generate_series(1, 100000) i`;
    await sql`vacuum analyze bank_transactions`;
    const plan = JSON.stringify(
      await sql`explain (format json) select id from bank_transactions where amount between 119000 and 119099 or amount between -119099 and -119000`,
    );
    expect(plan).toContain("bank_transactions_amount_search_idx");
  }, 60_000);

  it("zeigt Bankumsätze mit dem Hinweis der Bankseite und lässt ausgeschlossene Konten weg", async () => {
    const [ba, aus] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft'),
      ('Fremdkonto', 'DE02120300000000202051', 'geschaeft') returning id`;
    for (const [konto, nr] of [
      [ba!.id, 1],
      [aus!.id, 2],
    ] as const) {
      const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
        values (${konto}, ${`h${nr}.csv`}, ${`sha-hinweis-${nr}`}, 'csv', 2, 0) returning id`;
      await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
        values (${konto}, ${bi!.id}, '2026-10-01', -5000, 'Hinweisbank', ${`Ausgabe ${nr}`}, ${`hinweis-a${nr}`}),
               (${konto}, ${bi!.id}, '2026-10-02', 7000, 'Hinweisbank', ${`Eingang ${nr}`}, ${`hinweis-e${nr}`})`;
    }
    await sql`update bank_accounts set excluded_at = now() where id = ${aus!.id}`;
    const treffer = await search.runCommandPaletteSearch("Hinweisbank", "inhaber");
    expect(Object.fromEntries(treffer.bankTransactions.hits.map((t) => [t.purpose, t.hint]))).toEqual({ "Ausgabe 1": "belegFehlt", "Eingang 1": "offen" });
  });

  it("zeigt Voranmeldung und ZM je Zeitraum einmal, mit dem maßgeblichen Stand", async () => {
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`insert into vat_returns (year, month, status, sent_at, created_at) values (2026, 41, 'sent', '2026-04-10', '2026-04-09'), (2026, 41, 'draft', null, '2026-05-01'), (2026, 42, 'sent', '2026-07-10', '2026-07-09')`;
      await t`insert into zm_submissions (year, month, zeilen, kind, ok, code, message, request_xml, response_xml, server_response_xml, created_at) values
        (2026, 41, '[]', 'validate', true, 0, '', '', '', '', '2026-04-20'),
        (2026, 41, '[]', 'send', true, 0, '', '', '', '', '2026-04-21'),
        (2026, 41, '[]', 'validate', false, 610001, 'Fehler', '', '', '', '2026-04-22'),
        (2026, 42, '[]', 'send', false, 610001, 'Fehler', '', '', '', '2026-07-20')`;
    });
    const q1 = await search.runCommandPaletteSearch("Q1 2026", "inhaber");
    expect(q1.vatReturns.hits.map((v) => [v.month, v.status])).toEqual([[41, "draft"]]);
    expect(q1.zmSubmissions.hits.map((z) => [z.month, z.kind, z.ok])).toEqual([[41, "send", true]]);
    const jahr = await search.runCommandPaletteSearch("2026", "inhaber");
    expect(jahr.vatReturns.hits.map((v) => [v.month, v.status])).toEqual([
      [42, "sent"],
      [41, "draft"],
    ]);
    expect(jahr.zmSubmissions.hits.map((z) => [z.month, z.kind, z.ok, z.code])).toEqual([
      [42, "send", false, 610001],
      [41, "send", true, 0],
    ]);
  });

  it("zeigt stornierte Pauschalen, Kassenbuchungen und Buchungen als storniert, die Gegenzeilen der Pauschalen nicht", async () => {
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      const [p] =
        await t`insert into pauschalen (art, date, description, details, amount, journal_entry_id) values ('fahrt', '2026-09-15', 'Stornotermin', '{}', 3600, gen_random_uuid()) returning id`;
      await t`insert into pauschalen (art, date, description, details, amount, journal_entry_id, reverses_id) values ('fahrt', '2026-09-16', 'Stornotermin', '{}', -3600, gen_random_uuid(), ${p!.id})`;
      const [c] =
        await t`insert into cash_entries (number, date, amount, kind, text, journal_entry_id) values (9001, '2026-09-15', -1000, 'beleg', 'Stornokasse', gen_random_uuid()) returning id`;
      await t`insert into cash_entries (number, date, amount, kind, text, journal_entry_id, reverses_id) values (9002, '2026-09-16', 1000, 'beleg', 'Stornokasse', gen_random_uuid(), ${c!.id})`;
      const [j] =
        await t`insert into journal_entries (date, description, source_type, source_id, kontenrahmen, locked_at) values ('2026-09-15', 'Stornobuchung', 'manuell', gen_random_uuid(), 'SKR03', now()) returning id`;
      await t`insert into journal_entries (date, description, source_type, source_id, kontenrahmen, locked_at, reverses_id) values ('2026-09-16', 'Storno: Stornobuchung', 'manuell', gen_random_uuid(), 'SKR03', now(), ${j!.id})`;
    });
    const p = await search.runCommandPaletteSearch("Stornotermin", "inhaber");
    expect(p.pauschalen.hits.map((h) => [h.amount, h.storniert])).toEqual([[3600, true]]);
    const c = await search.runCommandPaletteSearch("Stornokasse", "inhaber");
    expect(c.cashEntries.hits.map((h) => [h.number, h.reversed])).toEqual([
      [9002, false],
      [9001, true],
    ]);
    const j = await search.runCommandPaletteSearch("Stornobuchung", "inhaber");
    expect(j.bookings.hits.map((h) => [h.description, h.reversed])).toEqual([
      ["Storno: Stornobuchung", false],
      ["Stornobuchung", true],
    ]);
  });

  it("findet Pauschalen über die Bezeichnung ihrer Art, die der Treffer zeigt, nicht über den gespeicherten Schlüssel", async () => {
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`insert into pauschalen (art, date, description, details, amount, journal_entry_id) values ('fahrt', '2026-09-15', 'Kundentermin', '{}', 3600, gen_random_uuid())`;
      await t`insert into pauschalen (art, date, description, details, amount, journal_entry_id) values ('entfernung', '2026-09-16', 'Pendeln', '{}', 1500, gen_random_uuid())`;
    });
    const texte = async (q: string) => (await search.runCommandPaletteSearch(q, "inhaber")).pauschalen.hits.map((h) => h.description);
    // PAUSCHALE_LABEL: „Fahrten mit dem Privatfahrzeug“, „Wege zwischen Wohnung und Betriebsstätte“
    expect(await texte("Privatfahrzeug")).toEqual(["Kundentermin"]);
    expect(await texte("Betriebsstatte")).toEqual(["Pendeln"]);
    expect(await texte("entfernung")).toEqual([]);
  });

  it("findet eine Buchung über ihren Bruttobetrag, nicht über Netto oder Steuer (Entscheidung zu #1038)", async () => {
    await sql.begin(async (tx) => {
      const [je] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-11-14', 'Bürostuhl', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        values (${je!.id}, '0420', 50000, 0), (${je!.id}, '1576', 9500, 0), (${je!.id}, '1200', 0, 59500)`;
      await tx`update journal_entries set locked_at = now() where id = ${je!.id}`;
    });
    const texte = async (q: string) => (await search.runCommandPaletteSearch(q, "inhaber")).bookings.hits.map((b) => b.description);
    expect(await texte("595,00")).toEqual(["Bürostuhl"]);
    expect(await texte("-595,00")).toEqual(["Bürostuhl"]);
    expect(await texte("500,00")).toEqual([]);
    expect(await texte("95,00")).toEqual([]);
  });

  it("findet eine Buchung nach § 13b über den gezahlten Betrag, obwohl keine Zeile die Summe einer Seite ist (#1038)", async () => {
    const { documentPosting } = await import("@haben/core");
    // Beleg aus dem EU-Ausland über 100,00 €: gezahlt wird netto, die Steuer steht als Umsatzsteuer und Vorsteuer
    const zeilen = documentPosting(
      { net: 10000, tax: 1900, gross: 10000, taxes: [{ rate: 1900, base: 10000, tax: 1900 }] },
      "software",
      "SKR03",
      "einzelunternehmen",
      "bank",
      true,
      undefined,
      0,
      "eu",
    );
    await sql.begin(async (tx) => {
      const [je] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-11-14', 'Cloudspeicher EU', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      for (const z of zeilen) await tx`insert into journal_lines (entry_id, account, debit, credit) values (${je!.id}, ${z.account}, ${z.debit}, ${z.credit})`;
      await tx`update journal_entries set locked_at = now() where id = ${je!.id}`;
    });
    const texte = async (q: string) => (await search.runCommandPaletteSearch(q, "inhaber")).bookings.hits.map((b) => b.description);
    expect(await texte("100,00")).toEqual(["Cloudspeicher EU"]);
    expect(await texte("19,00")).toEqual([]);
  });

  /** Zählt die Abfragen einer Suche an der Verbindung, über die alle Module lesen */
  async function abfragenFuer(eingabe: string, rolle: "inhaber" | "steuerberatung") {
    const { db } = await import("../db/index.ts");
    const client = db.$client as unknown as { unsafe: (...args: unknown[]) => unknown };
    const original = client.unsafe;
    let anzahl = 0;
    client.unsafe = (...args: unknown[]) => {
      anzahl += 1;
      return original.apply(client, args);
    };
    try {
      await search.runCommandPaletteSearch(eingabe, rolle);
    } finally {
      client.unsafe = original;
    }
    return anzahl;
  }

  it("fragt je Modul eine Abfrage statt je Gruppe (#617: vorher 24 für Text, 26 für Ziffern, 7 für die Steuerberatung)", async () => {
    // Stammdaten, Rechnungen, Belege, Bank, Buchhaltung (eigene Konten, Kontenrahmen, Abfrage), Leistungen, Lohn, Postfach, Archiv
    expect(await abfragenFuer("Zzyzx", "inhaber")).toBeLessThanOrEqual(11);
    // dazu Voranmeldungen und ZM in einer Abfrage
    expect(await abfragenFuer("4931", "inhaber")).toBeLessThanOrEqual(12);
    expect(await abfragenFuer("Zzyzx", "steuerberatung")).toBeLessThanOrEqual(5);
  });

  it("nutzt in der gemeinsamen Abfrage der Bank bei 100.000 Bankumsätzen weiter die Trigramm-Indizes", async () => {
    const [ba] = await sql`insert into bank_accounts (name, iban, purpose) values ('Konto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [bi] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${ba!.id}, 'gemeinsam.csv', 'sha-gemeinsam', 'csv', 100000, 0) returning id`;
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, counterparty_iban, purpose, dedup_hash)
      select ${ba!.id}, ${bi!.id}, date '2020-01-01' + (i % 2000), i - 50000, 'Gegenseite ' || (i % 5000),
        'DE' || lpad(i::text, 20, '0'), 'Verwendung ' || md5(i::text), 'gemeinsam-' || i
      from generate_series(1, 100000) i`;
    await sql`vacuum analyze bank_transactions`;
    const { bankSearchParts } = await import("../modules/bank/search.ts");
    const { searchPartsQuery } = await import("../db/search-parts.ts");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const query = new PgDialect().sqlToQuery(searchPartsQuery(bankSearchParts("Hosting", ["bankTransactions", "loans", "cashEntries"], 5)));
    const [row] = await sql.unsafe(`explain (format json) ${query.sql}`, query.params as never[]);
    type Knoten = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: Knoten[] };
    const knoten = (k: Knoten): Knoten[] => [k, ...(k.Plans ?? []).flatMap(knoten)];
    const alle = knoten((row as unknown as { "QUERY PLAN": { Plan: Knoten }[] })["QUERY PLAN"][0]!.Plan);
    expect(alle.map((k) => k["Index Name"])).toEqual(
      expect.arrayContaining(["bank_transactions_counterparty_name_trgm_idx", "bank_transactions_purpose_trgm_idx"]),
    );
    expect(alle.filter((k) => k["Node Type"] === "Seq Scan").map((k) => k["Relation Name"])).not.toContain("bank_transactions");
    const treffer = await search.runCommandPaletteSearch("Gegenseite 4711", "inhaber");
    expect(treffer.bankTransactions.hits.length).toBe(5);
    expect(treffer.bankTransactions.more).toBe(true);
  }, 60_000);

  it("bleibt bei einer Kontonummer mit 20.000 Buchungszeilen unter der Grenze für JIT (#617)", async () => {
    await sql.begin(async (tx) => {
      await tx`insert into journal_entries (id, date, description, source_type, source_id, kontenrahmen)
        select md5('jit' || i)::uuid, date '2020-01-01' + (i % 2000), 'Buchung ' || md5(i::text), 'manuell', gen_random_uuid(), 'SKR03'
        from generate_series(1, 20000) i`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        select md5('jit' || i)::uuid, a.account, case when a.debit > 0 then a.debit + i else 0 end, case when a.credit > 0 then a.credit + i else 0 end
        from generate_series(1, 20000) i, (values ('4930', 5000, 0), ('1200', 0, 5000)) a(account, debit, credit)`;
      await tx`update journal_entries set locked_at = now() where locked_at is null`;
    });
    await sql`vacuum analyze journal_entries`;
    await sql`vacuum analyze journal_lines`;
    const { bookingEntriesQuery } = await import("../modules/buchhaltung/search.ts");
    // „4930“ ist Konto und ganzer Euro zugleich; das Übersetzen mit JIT kostete hier rund 100 ms, die Abfrage selbst 10 ms
    const { select } = await bookingEntriesQuery("4930", 5);
    const query = select.toSQL();
    const [row] = await sql.unsafe(`explain (format json) ${query.sql}`, query.params as never[]);
    const [grenze] = await sql`select current_setting('jit_above_cost')::float as jit_above_cost`;
    const kosten = (row as unknown as { "QUERY PLAN": { Plan: { "Total Cost": number } }[] })["QUERY PLAN"][0]!.Plan["Total Cost"];
    expect(kosten).toBeLessThan(grenze!.jit_above_cost);
  }, 60_000);
});
