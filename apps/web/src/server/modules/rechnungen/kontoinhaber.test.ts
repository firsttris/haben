import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kontoinhaber (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  let contactId: string;

  const invoiceDraft = () =>
    invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-03-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
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
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "buchhaltung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  it("schreibt den Kontoinhaber in Verkäufer und XML der festgeschriebenen Rechnung", async () => {
    await sql`update company set kontoinhaber = 'Max Mustermann' where id = 1`;
    const final = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    expect(final.seller).toMatchObject({ name: "Testfirma", kontoinhaber: "Max Mustermann" });
    expect(final.xml).toMatch(/<ram:AccountName>Max Mustermann<\/ram:AccountName>/);
  });

  it("lässt den Kontoinhaber ohne Angabe weg; das XML nennt wie bisher die Firma", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    expect(final.seller).not.toHaveProperty("kontoinhaber");
    expect(final.xml).toMatch(/<ram:AccountName>Testfirma<\/ram:AccountName>/);
  });
});
