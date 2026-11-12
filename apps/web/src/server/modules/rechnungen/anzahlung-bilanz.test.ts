import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #750: Vor der Leistung kein Erlös (§ 252 Abs. 1 Nr. 4 und 5 HGB), unabhängig vom Umsatzsteuerverfahren.
 * Die Regressionen legen noch keine der im ADR offenen Kontierungsentscheidungen fest.
 * Quelle: https://www.gesetze-im-internet.de/hgb/__252.html
 */
describe.skipIf(!testDatabaseUrl)("Anzahlungsbilanzierung bei GmbH und UG (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let contactId: string;
  const actor = "anzahlung-bilanz-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
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
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function finalInvoice(advanceId: string) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2027-01-20",
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
      expect(await revenue(2026, ACCOUNTS[frame].erloese[1900])).toBe(0);
      expect((await bank.cashBook(2026)).entries).toHaveLength(0);
    });

    it(`${form}, ${frame}, ${vatMode}: auch eine Teilzahlung vor Leistung erzeugt keinen Erlös`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${vatMode}`;
      const invoice = await advance();
      await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 11_900 }, "2026-12-12");
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
  }
});
