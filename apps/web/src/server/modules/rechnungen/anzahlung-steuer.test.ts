import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** #622: Die Anforderung einer Anzahlung ist bei Soll noch kein ausgeführter Umsatz (§ 13 Abs. 1 Nr. 1 a UStG). */
describe.skipIf(!testDatabaseUrl)("Anzahlung vor Leistung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let contactId: string;
  const actor = "anzahlung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
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

  async function advance(rate: 1900 | 700 = 1900) {
    const input = {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      variant: "abschlag" as const,
      advanceType: "anzahlung" as const,
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: rate }],
    };
    return invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
  }

  async function tax(year: number, month: number, base: number, amount: number, rate: 1900 | 700 = 1900) {
    expect(await vat.computeVatFigures({ year, month })).toMatchObject(rate === 1900 ? { kz81: base, tax81: amount } : { kz86: base, tax86: amount });
    expect((await reports.vatAbgleich({ year, month })).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
  }

  it("Soll: Dezember-Anforderung ohne Steuer; Januar-Zahlung mit 300 € Bemessungsgrundlage und 57 € Steuer", async () => {
    const invoice = await advance();
    await tax(2026, 12, 0, 0);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 30_000, 5_700);
    await tax(2026, 12, 0, 0);
    const booked = await sql`select l.account, sum(l.credit - l.debit)::int as amount from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.date >= '2027-01-01' group by l.account`;
    expect(booked).toContainEqual({ account: ACCOUNTS.SKR03.ust[1900], amount: 5_700 });
  });

  it("SKR04, 7 %: zwei Teilzahlungen versteuern den Abschlag nur anteilig und insgesamt genau einmal", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    const invoice = await advance(700);
    await tax(2026, 12, 0, 0, 700);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 10_700 }, "2027-02-12");
    await tax(2027, 1, 10_000, 700, 700);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 21_400 }, "2027-02-12");
    await tax(2027, 2, 20_000, 1_400, 700);
  });

  it("ein nie bezahlter, stornierter Abschlag löst in keinem Monat Umsatzsteuer aus", async () => {
    const invoice = await advance();
    await invoices.cancelInvoice(actor, invoice.id, "2027-01-15");
    await tax(2026, 12, 0, 0);
    await tax(2027, 1, 0, 0);
  });

  it("Ist bleibt bei der Zahlung steuerpflichtig", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const invoice = await advance();
    await tax(2026, 12, 0, 0);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 30_000, 5_700);
  });

  async function finalInvoice(advanceId: string) {
    const draft = await invoices.createDraft(actor, {
      contactId, issueDate: "2027-01-20", serviceFrom: "2027-01-20", serviceTo: null,
      paymentTermDays: 14, format: "zugferd", note: "", variant: "schluss", deducts: [advanceId],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  it("die Schlussrechnung versteuert auch den unbezahlten Abschlag; seine spätere Zahlung entsteht nicht doppelt", async () => {
    const invoice = await advance();
    const final = await finalInvoice(invoice.id);
    expect(final).toMatchObject({ net: 70_000, tax: 13_300, gross: 83_300 });
    await tax(2026, 12, 0, 0);
    await tax(2027, 1, 100_000, 19_000);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 35_700 }, "2027-02-12");
    await tax(2027, 2, 0, 0);
    await tax(2027, 1, 100_000, 19_000);
  });

  it("eine erst nach der Schlussrechnung zugeordnete Dezemberzahlung verschiebt ihren Steueranteil korrekt zurück", async () => {
    const invoice = await advance();
    await finalInvoice(invoice.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 11_900 }, "2027-02-12");
    await tax(2026, 12, 10_000, 1_900);
    await tax(2027, 1, 90_000, 17_100);
  });

  it("eine ausdrücklich erbrachte Teilleistung wird bei Soll im Leistungsmonat besteuert", async () => {
    const input = {
      contactId, issueDate: "2026-12-01", serviceFrom: "2026-11-05", serviceTo: null,
      paymentTermDays: 14, format: "zugferd" as const, note: "", variant: "abschlag" as const, advanceType: "teilleistung" as const,
      lines: [{ description: "Abgenommene Teilleistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: 1900 }],
    };
    await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
    await tax(2026, 11, 30_000, 5_700);
    await tax(2026, 12, 0, 0);
  });
});
