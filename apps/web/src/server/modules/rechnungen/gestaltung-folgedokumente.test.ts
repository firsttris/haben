import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Gestaltung und festgeschriebene Belege (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let dunning: typeof import("./dunning.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let sql: postgres.Sql;
  let invoiceId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    dunning = await import("./dunning.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate letterhead_profiles, company_logo, dunnings, journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "10001",
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
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    invoiceId = (await invoices.finalizeInvoice(actor, draft.id)).id;
  }, 30_000);

  const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

  it("das PDF eines festgeschriebenen Belegs bleibt, eine neue Mahnung nimmt die aktuelle Gestaltung", async () => {
    const input = { invoiceId, level: 1 as const, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    const [before] = await sql`select pdf from invoices where id = ${invoiceId}`;
    const dunningBefore = await dunning.dunningDraftPdf(input, "2026-10-15");

    await stammdaten.saveDesign(actor, { accent: "#9B1C1C", foldMarks: false });

    const [after] = await sql`select pdf from invoices where id = ${invoiceId}`;
    expect(same(after!.pdf, before!.pdf)).toBe(true);
    expect(same((await dunning.dunningDraftPdf(input, "2026-10-15")).pdf, dunningBefore.pdf)).toBe(false);
  });
});
