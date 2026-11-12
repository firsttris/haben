import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #750: Vor der Leistung kein Erlös (§ 252 Abs. 1 Nr. 4 und 5 HGB), unabhängig vom Umsatzsteuerverfahren.
 * Kontierung und Fortbestand der Leistung nach Rechnungsstorno: Maintainerentscheid in #750.
 * Quelle: https://www.gesetze-im-internet.de/hgb/__252.html
 */
describe.skipIf(!testDatabaseUrl)("Anzahlungsbilanzierung bei GmbH und UG (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let contactId: string;
  const actor = "anzahlung-bilanz-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  });
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

  async function advance(unitPrice = 30_000) {
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
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
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
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function revenue(year: number, account: string) {
    const [row] = await sql`select coalesce(sum(l.credit - l.debit), 0)::int as amount
      from journal_lines l join journal_entries e on e.id = l.entry_id
      where l.account = ${account} and e.date >= ${`${year}-01-01`} and e.date < ${`${year + 1}-01-01`}`;
    return row!.amount;
  }

  const variants = [
    { form: "gmbh", frame: "SKR03", vatMode: "soll" },
    { form: "ug", frame: "SKR04", vatMode: "ist" },
  ] as const;
  for (const { form, frame, vatMode } of variants) {
    it(`${form}, ${frame}, ${vatMode}: eine unbezahlte Anforderung erzeugt keinen Erlös`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      await advance();
      expect(await sql`select id from journal_entries`).toEqual([]);
      expect(await revenue(2026, ACCOUNTS[frame].erloese[1900])).toBe(0);
      expect((await bank.cashBook(2026)).entries).toHaveLength(0);
    });

    it(`${form}, ${frame}, ${vatMode}: auch eine Teilzahlung vor Leistung erzeugt keinen Erlös`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const invoice = await advance();
      await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 11_900 }, "2026-12-12");
      expect(await revenue(2026, ACCOUNTS[frame].erhalteneAnzahlungen)).toBe(10_000);
      expect(await revenue(2026, ACCOUNTS[frame].erloese[1900])).toBe(0);
      expect((await bank.cashBook(2026)).entries).toHaveLength(1);
    });

    it(`${form}, ${frame}, ${vatMode}: die Schlussleistung realisiert im Januar genau 1.000 € netto`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const invoice = await advance();
      await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 35_700 }, "2026-12-12");
      await finalInvoice(invoice.id);
      expect(await revenue(2027, ACCOUNTS[frame].erloese[1900])).toBe(100_000);
      expect(await revenue(2026, ACCOUNTS[frame].erloese[1900])).toBe(0);
      expect((await bank.cashBook(2026)).entries).toHaveLength(1);
      expect((await bank.cashBook(2027)).entries).toHaveLength(0);
    });

    it(`${form}, ${frame}, ${vatMode}: vollständige Anzahlung wird auch bei Schlussrest null im Leistungsjahr zum Erlös`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const invoice = await advance(100_000);
      await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 119_000 }, "2026-12-12");
      const final = await finalInvoice(invoice.id);
      expect(final.gross).toBe(0);
      expect(await revenue(2026, ACCOUNTS[frame].erloese[1900])).toBe(0);
      expect(await revenue(2027, ACCOUNTS[frame].erloese[1900])).toBe(100_000);
      expect((await bank.cashBook(2026)).entries).toHaveLength(1);
      expect((await bank.cashBook(2027)).entries).toHaveLength(0);
      const [balance] = await sql`select coalesce(sum(credit - debit), 0)::int as amount
        from journal_lines where account = ${ACCOUNTS[frame].erhalteneAnzahlungen}`;
      expect(balance!.amount).toBe(0);
    });

    it(`${form}, ${frame}, ${vatMode}: Schluss-Storno im Februar und Ersatz im März verschieben die erbrachte Januarleistung nicht`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const invoice = await advance();
      await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 35_700 }, "2026-12-12");
      const final = await finalInvoice(invoice.id);
      await invoices.cancelInvoice(actor, final.id, "2027-02-12");
      const replacement = await finalInvoice(invoice.id, "2027-03-12");
      expect(replacement.gross).toBe(83_300);
      const months = await sql`select to_char(e.date, 'YYYY-MM') as month, sum(l.credit - l.debit)::int as amount
        from journal_entries e join journal_lines l on l.entry_id = e.id
        where l.account = ${ACCOUNTS[frame].erloese[1900]} and e.date >= '2027-01-01'
        group by to_char(e.date, 'YYYY-MM') having sum(l.credit - l.debit) <> 0 order by month`;
      expect(months).toEqual([{ month: "2027-01", amount: 100_000 }]);
      const figures = await Promise.all([1, 2, 3].map((month) => vat.computeVatFigures({ year: 2027, month })));
      expect(figures.map(({ kz81, tax81 }) => ({ base: kz81, tax: tax81 }))).toEqual([
        { base: vatMode === "soll" ? 70_000 : 0, tax: vatMode === "soll" ? 13_300 : 0 },
        { base: 0, tax: 0 },
        { base: 0, tax: 0 },
      ]);
      expect((await bank.cashBook(2026)).entries).toHaveLength(1);
      expect((await bank.cashBook(2027)).entries).toHaveLength(0);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    });
  }
});
