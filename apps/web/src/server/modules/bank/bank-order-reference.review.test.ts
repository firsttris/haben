import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Review: Erstattungen mit ausschließlich externer Bestellnummer (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Testkunde",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "kunde@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  async function finalInvoice(externalId: string, issueDate: string) {
    const { invoice } = await invoices.createDraftForReference(
      actor,
      {
        contactId,
        issueDate,
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description: "Bestellung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
      },
      { externalSource: "etsy", externalId },
    );
    return invoices.finalizeInvoice(actor, invoice.id);
  }

  function statement() {
    const head = '"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 20.09.2026:";"119,00 €"\n""\n';
    const columns =
      '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n';
    const rows = [
      ["07.09.26", "Verkauf 1000000001", "119,00"],
      ["08.09.26", "Verkauf 1000000002", "119,00"],
      ["15.09.26", "Refund for Order #1000000002", "-119,00"],
    ].map(([date, purpose, amount]) => [date, date, "Gebucht", "Etsy", "Testfirma", purpose, "Umsatz", "", amount, "", "", ""]);
    return new TextEncoder().encode(`\uFEFF${head}${columns}${rows.map((row) => row.map((v) => `"${v}"`).join(";")).join("\n")}\n`);
  }

  it.each(["storno", "korrektur"] as const)(
    "findet die richtige %s-Erstattung, wenn die API nur externalId gesetzt hat",
    async (kind) => {
      const older = await finalInvoice("1000000001", "2026-09-05");
      const wanted = await finalInvoice("1000000002", "2026-09-06");
      await bank.importStatement(actor, { bytes: statement(), filename: "a.csv" }, null);
      for (const [invoice, purpose] of [
        [older, "Verkauf 1000000001"],
        [wanted, "Verkauf 1000000002"],
      ] as const) {
        const [payment] = await sql`select id from bank_transactions where purpose = ${purpose}`;
        await bank.allocate(actor, { kind: "invoice", transactionId: payment!.id, invoiceId: invoice.id, amount: 11_900 });
      }
      const refundOf = async (id: string, date: string) =>
        kind === "storno" ? invoices.cancelInvoice(actor, id, date) : invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, id, date)).id);
      await refundOf(older.id, "2026-09-10");
      const correctRefund = await refundOf(wanted.id, "2026-09-11");
      const [refund] = await sql`select id from bank_transactions where amount = -11900`;
      const detail = await bank.transactionDetail(refund!.id);
      expect(detail?.suggestions[0]?.item.number).toBe(correctRefund.number);
      expect(detail?.suggestions[0]?.reasons).toContain("Bestellnummer im Verwendungszweck (1000000002)");
    },
    30_000,
  );
});
