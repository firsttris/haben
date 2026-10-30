import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("TDD: Rundung bei Storno und Korrekturen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (unitPrice: number, taxRate: 1900 | 700 | 0 = 1900, quantity = 1000) => ({
    description: "Frontend-Entwicklung",
    quantity,
    unit: "Std." as const,
    unitPrice,
    taxRate,
  });

  const draft = (lines = [line(100_000)], extra: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines,
    ...extra,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 'soll')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "buchhaltung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  });

  it("Storno einer korrigierten Rechnung nimmt nicht mehr Umsatzsteuer zurück, als Rechnung und Korrektur ausweisen", async () => {
    // 100,00 € + 19,00 €; Korrektur −0,50 € (Steuer −0,095 → −0,10 €)
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft([line(10_000)]))).id);
    const correction = await invoices.createCorrection(actor, original.id, "2026-10-05");
    await invoices.updateDraft(actor, correction.id, { ...draft([line(-50)]), issueDate: "2026-10-05", paymentTermDays: 0 });
    await invoices.finalizeInvoice(actor, correction.id);
    await invoices.cancelInvoice(actor, original.id, "2026-10-06");
    const [sum] = await sql`select sum(net)::int as net, sum(tax)::int as tax from invoices where status = 'final'`;
    expect(sum).toEqual({ net: 0, tax: 0 });
  }, 60_000);

  it("zwei Korrekturen, die den Nettobetrag genau auf 0 mindern, lassen sich festschreiben", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft([line(10_000)]))).id);
    const first = await invoices.createCorrection(actor, original.id, "2026-10-05");
    await invoices.updateDraft(actor, first.id, { ...draft([line(-50)]), issueDate: "2026-10-05", paymentTermDays: 0 });
    await invoices.finalizeInvoice(actor, first.id);
    const second = await invoices.createCorrection(actor, original.id, "2026-10-06");
    await invoices.updateDraft(actor, second.id, { ...draft([line(-9_950)]), issueDate: "2026-10-06", paymentTermDays: 0 });
    await expect(invoices.finalizeInvoice(actor, second.id)).resolves.toMatchObject({ status: "final" });
  }, 60_000);
});
