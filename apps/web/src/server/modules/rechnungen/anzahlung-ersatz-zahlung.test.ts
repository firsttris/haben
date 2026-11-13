import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #750: Ein Papierstorno nimmt die erbrachte Schlussleistung nicht zurück. Zahlungen gehören weiter zu dieser
 * Leistung, auch wenn der betragsgleiche Ersatz eine neue Belegnummer bekommt; die gesiegelten Zahlungen bleiben stehen.
 * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
describe.skipIf(!testDatabaseUrl)("Zahlungen auf die ersetzte GmbH-/UG-Schlussrechnung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let contactId: string;
  const actor = "anzahlung-ersatz-zahlung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    reports = await import("../auswertungen/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
      'BY', 'DE89370400440532013000', 'SKR03', 'soll', 2026)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  const listed = async (id: string, today = "2027-04-20") => (await invoices.listInvoices(today)).find((invoice) => invoice.id === id);
  const cashRows = () => sql`select * from cash_entries order by number`;

  async function advance() {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "anzahlung",
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    expect(invoice).toMatchObject({ advanceAccounting: "deferred", gross: 35_700 });
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 35_700 }, "2026-12-12");
    return invoice;
  }

  async function finalInvoice(advanceId: string, issueDate = "2027-01-20") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: "2027-01-20",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "schluss",
      deducts: [advanceId],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    expect(invoice).toMatchObject({ advanceAccounting: "deferred", gross: 83_300 });
    return invoice;
  }

  async function onlyOpen(id: string, open: number, today = "2027-04-20") {
    const positions = await reports.openPositions(today);
    expect(positions.receivables.map((position) => ({ id: position.id, open: position.open }))).toEqual(open ? [{ id, open }] : []);
    expect(positions.receivablesTotal).toBe(open);
  }

  async function noTransferredPayments() {
    expect(await sql`select id from allocations`).toEqual([]);
    expect(await sql`select id from write_offs`).toEqual([]);
  }

  for (const { form, frame, vatMode } of [
    { form: "gmbh", frame: "SKR03", vatMode: "soll" },
    { form: "ug", frame: "SKR04", vatMode: "ist" },
  ] as const) {
    it(`${form}, ${frame}, ${vatMode}: bezahlter Schlussrest bleibt beim Papierstorno und Ersatz bezahlt, ohne Erstattung oder zweite Kasse`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const paidAdvance = await advance();
      const original = await finalInvoice(paidAdvance.id);
      const payment = await bank.createCashInvoiceEntry(actor, { invoiceId: original.id, date: "2027-01-25", amount: 83_300 }, "2027-01-25");
      expect(payment.taxShares).toEqual([{ rate: 1900, base: 70_000, tax: 13_300 }]);
      const unchanged = await cashRows();

      const cancellation = await invoices.cancelInvoice(actor, original.id, "2027-02-12");
      expect(await listed(cancellation.id)).toMatchObject({ open: 0 });
      await onlyOpen(original.id, 0);
      expect(await cashRows()).toEqual(unchanged);

      const replacement = await finalInvoice(paidAdvance.id, "2027-03-12");
      expect(replacement).toMatchObject({ replacesInvoiceId: original.id });
      expect(await listed(original.id)).toMatchObject({ paid: 83_300, open: 0 });
      expect(await listed(replacement.id)).toMatchObject({ paid: 83_300, open: 0, listStatus: "bezahlt" });
      expect(await listed(cancellation.id)).toMatchObject({ open: 0 });
      await onlyOpen(replacement.id, 0);
      await expect(bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-03-20", amount: 1 }, "2027-03-20")).rejects.toThrow();
      expect(await cashRows()).toEqual(unchanged);
      await noTransferredPayments();

      expect((await bank.cashBook(2026)).entries).toHaveLength(1);
      expect((await bank.cashBook(2027)).entries).toHaveLength(1);
      expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
      expect(await vat.computeVatFigures({ year: 2027, month: 1 })).toMatchObject({ kz81: 70_000, tax81: 13_300 });
      expect(await vat.computeVatFigures({ year: 2027, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
      expect(await vat.computeVatFigures({ year: 2027, month: 3 })).toMatchObject({ kz81: 0, tax81: 0 });
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    });
  }

  it("UG, SKR04, Ist: Teilzahlungen des alten Schlusses zählen zum Restsaldo und zur kumulierten Cent-Rundung des Ersatzes", async () => {
    await sql`update company set rechtsform = 'ug', kontenrahmen = 'SKR04', versteuerung = 'ist'`;
    const paidAdvance = await advance();
    const original = await finalInvoice(paidAdvance.id);
    const first = await bank.createCashInvoiceEntry(actor, { invoiceId: original.id, date: "2027-01-25", amount: 10_000 }, "2027-01-25");
    expect(first.taxShares).toEqual([{ rate: 1900, base: 8_403, tax: 1_597 }]);
    const unchanged = await cashRows();

    const cancellation = await invoices.cancelInvoice(actor, original.id, "2027-02-12");
    expect(await listed(cancellation.id)).toMatchObject({ open: 0 });
    expect(await cashRows()).toEqual(unchanged);
    const replacement = await finalInvoice(paidAdvance.id, "2027-03-12");
    expect(replacement).toMatchObject({ replacesInvoiceId: original.id });
    expect(await listed(replacement.id)).toMatchObject({ paid: 10_000, open: 73_300, listStatus: "teilbezahlt" });
    await onlyOpen(replacement.id, 73_300);
    expect(await cashRows()).toEqual(unchanged);
    await expect(bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-03-20", amount: 73_301 }, "2027-03-20")).rejects.toThrow();

    const second = await bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-03-20", amount: 10_000 }, "2027-03-20");
    // Zweimal 100 €: zusammen 31,93 € USt, nicht zweimal einzeln auf 15,97 € gerundet.
    expect(second.taxShares).toEqual([{ rate: 1900, base: 8_404, tax: 1_596 }]);
    expect(second).toMatchObject({ invoiceId: replacement.id, taxSharesInvoiceId: replacement.id });
    expect(await listed(replacement.id)).toMatchObject({ paid: 20_000, open: 63_300 });
    await onlyOpen(replacement.id, 63_300);
    await expect(bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-04-20", amount: 63_301 }, "2027-04-20")).rejects.toThrow();

    const rest = await bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-04-20", amount: 63_300 }, "2027-04-20");
    expect(rest.taxShares).toEqual([{ rate: 1900, base: 53_193, tax: 10_107 }]);
    expect(await listed(replacement.id)).toMatchObject({ paid: 83_300, open: 0, listStatus: "bezahlt" });
    expect(await listed(original.id)).toMatchObject({ open: 0 });
    expect(await listed(cancellation.id)).toMatchObject({ open: 0 });
    await onlyOpen(replacement.id, 0);
    const stored = await cashRows();
    expect(stored).toHaveLength(4);
    expect(stored.slice(0, unchanged.length)).toEqual(unchanged);
    expect(stored.map((row) => row.amount)).toEqual([35_700, 10_000, 10_000, 63_300]);
    await noTransferredPayments();
    const figures = await Promise.all([1, 2, 3, 4].map((month) => vat.computeVatFigures({ year: 2027, month })));
    expect(figures.map(({ kz81, tax81 }) => ({ base: kz81, tax: tax81 }))).toEqual([
      { base: 8_403, tax: 1_597 },
      { base: 0, tax: 0 },
      { base: 8_404, tax: 1_596 },
      { base: 53_193, tax: 10_107 },
    ]);
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("GmbH, SKR03, Soll: Ersatz im nächsten Jahr behält alte Schlusszahlungen und die Steuer im Leistungsjahr", async () => {
    await sql`update company set rechtsform = 'gmbh', kontenrahmen = 'SKR03', versteuerung = 'soll'`;
    const paidAdvance = await advance();
    const original = await finalInvoice(paidAdvance.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: original.id, date: "2027-01-25", amount: 10_000 }, "2027-01-25");
    const unchanged = await cashRows();
    const cancellation = await invoices.cancelInvoice(actor, original.id, "2027-02-12");
    const replacement = await finalInvoice(paidAdvance.id, "2028-03-12");
    expect(replacement).toMatchObject({ replacesInvoiceId: original.id });
    expect(await listed(replacement.id, "2028-03-20")).toMatchObject({ paid: 10_000, open: 73_300 });
    expect(await listed(cancellation.id, "2028-03-20")).toMatchObject({ open: 0 });
    await onlyOpen(replacement.id, 73_300, "2028-03-20");
    expect(await cashRows()).toEqual(unchanged);

    const rest = await bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2028-03-20", amount: 73_300 }, "2028-03-20");
    expect(rest.taxShares).toEqual([{ rate: 1900, base: 61_597, tax: 11_703 }]);
    expect(await listed(replacement.id, "2028-03-20")).toMatchObject({ paid: 83_300, open: 0 });
    await onlyOpen(replacement.id, 0, "2028-03-20");
    const stored = await cashRows();
    expect(stored).toHaveLength(3);
    expect(stored.slice(0, unchanged.length)).toEqual(unchanged);
    expect((await bank.cashBook(2026)).entries).toHaveLength(1);
    expect((await bank.cashBook(2027)).entries).toHaveLength(1);
    expect((await bank.cashBook(2028)).entries).toHaveLength(1);
    await noTransferredPayments();
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
    expect(await vat.computeVatFigures({ year: 2027, month: 1 })).toMatchObject({ kz81: 70_000, tax81: 13_300 });
    expect(await vat.computeVatFigures({ year: 2027, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
    expect(await vat.computeVatFigures({ year: 2028, month: 3 })).toMatchObject({ kz81: 0, tax81: 0 });
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
