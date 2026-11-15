import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** #750: Ein bloßes Schluss-Papierstorno begründet keine Erstattung; ein echter Anzahlungsstorno vor Leistung schon. */
describe.skipIf(!testDatabaseUrl)("Bankerstattung bei Anzahlungs- und Schlussstorno (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let contactId: string;
  const actor = "advance-paper-refund-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung, journal_ab)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', ${iban}, 'SKR03', 'ist', 2026)`;
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
        iban: "DE02120300000000202051",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  /** Fiktiver Kontoauszug über denselben öffentlichen Import wie beim Bankabgleich. */
  async function transaction(date: string, purpose: string, amount: string) {
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${date}";"${date}";"Gebucht";"Nordwerk Software GmbH";"Test GmbH";"${purpose}";"Überweisung";"DE02120300000000202051";"${amount}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${purpose}.csv` }, null);
    return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id as string;
  }

  async function paidAdvance() {
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
    const payment = await transaction("12.12.26", "Anzahlung", "357,00");
    await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: invoice.id, amount: 35_700 });
    return invoice;
  }

  it("lehnt die direkte Bank-Erstattung auf ein bezahltes Schluss-Papierstorno auch außerhalb der offenen Vorschläge ab", async () => {
    const advance = await paidAdvance();
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2027-01-20",
      serviceFrom: "2027-01-20",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "schluss",
      deducts: [advance.id],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final).toMatchObject({ advanceAccounting: "deferred", gross: 83_300 });
    const payment = await transaction("25.01.27", "Schlusszahlung", "833,00");
    await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: final.id, amount: 83_300 });
    const cancellation = await invoices.cancelInvoice(actor, final.id, "2027-02-12");
    expect((await bank.openItems()).some((item) => item.id === cancellation.id)).toBe(false);
    const refund = await transaction("20.02.27", "Unberechtigte Erstattung", "-833,00");
    const allocations = await sql`select * from allocations order by id`;
    const journal = await sql`select * from journal_entries order by id`;

    await expect(bank.allocate(actor, { kind: "invoice", transactionId: refund, invoiceId: cancellation.id, amount: -83_300 })).rejects.toThrow(bank.BankError);

    expect((await bank.transactionDetail(refund))?.transaction.open).toBe(-83_300);
    expect(await sql`select * from allocations order by id`).toEqual(allocations);
    expect(await sql`select * from journal_entries order by id`).toEqual(journal);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("lässt die tatsächliche Erstattung einer bezahlten Anforderung nach deren Storno vor der Leistung weiter zu", async () => {
    const advance = await paidAdvance();
    const cancellation = await invoices.cancelInvoice(actor, advance.id, "2027-01-10");
    expect(cancellation).toMatchObject({ advanceAccounting: "deferred" });
    expect((await bank.openItems()).map((item) => ({ id: item.id, open: item.open }))).toEqual([{ id: cancellation.id, open: -35_700 }]);
    const refund = await transaction("20.01.27", "Anzahlung zurück", "-357,00");

    await bank.allocate(actor, { kind: "invoice", transactionId: refund, invoiceId: cancellation.id, amount: -35_700 });

    expect((await bank.transactionDetail(refund))?.transaction.open).toBe(0);
    expect(await bank.openItems()).toEqual([]);
    expect(await sql`select invoice_id, amount from allocations where transaction_id = ${refund}`).toEqual([{ invoice_id: cancellation.id, amount: -35_700 }]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
