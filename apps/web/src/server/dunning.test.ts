import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Mahnwesen (Postgres)", () => {
  let dunning: typeof import("./dunning.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  let invoiceId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    dunning = await import("./dunning.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate dunnings, journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "rechnung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id, issueDate: "2026-09-01", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    invoiceId = (await invoices.finalizeInvoice(actor, draft.id)).id;
  }, 30_000);

  it("überfällige Rechnung: Vorschlag, Mahnung mit Zinsen und PDF, danach nächste Stufe", async () => {
    // fällig am 15.09.2026
    const [overdue] = await dunning.overdueInvoices("2026-10-15");
    expect(overdue).toMatchObject({ id: invoiceId, nextLevel: 1, waiting: false, lastDunning: null });

    const draft = await dunning.dunningDraft(invoiceId, "2026-10-15");
    expect(draft).toMatchObject({ level: 1, dueDate: "2026-10-25", fee: 0, baseRate: 127 });

    const created = await dunning.createDunning(
      actor,
      { invoiceId, level: 2, dueDate: "2026-10-25", fee: 500, flatFee: true, interest: "geschaeftskunde", intro: "Bitte zahlen.", closing: "" },
      "2026-10-15",
    );
    // 1.190 € zu 10,27 % für 30 Tage = 10,04 €; die Mahngebühr von 5 € geht in der Pauschale von 40 € auf
    expect(created).toMatchObject({ level: 2, open: 119_000, fee: 0, flatFee: 4_000, interest: 1_004, interestRate: 1_027, interestDays: 30, total: 124_004 });
    const pdf = await dunning.loadDunningPdf(created.id);
    expect(Buffer.from(pdf!.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf!.filename).toMatch(/^Mahnung-2026-001\.pdf$/);

    const [after] = await dunning.overdueInvoices("2026-10-20");
    expect(after).toMatchObject({ nextLevel: 3, waiting: true });
    await expect(sql`delete from dunnings`).rejects.toThrow("darf nur ergänzt werden");
  });

  it("keine zweite Mahnung derselben oder einer niedrigeren Stufe, auch nicht gleichzeitig", async () => {
    const input = { invoiceId, level: 1 as const, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    const results = await Promise.allSettled([dunning.createDunning(actor, input, "2026-10-15"), dunning.createDunning(actor, input, "2026-10-15")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/schon mit „Zahlungserinnerung“ gemahnt/);
    await dunning.createDunning(actor, { ...input, level: 3 }, "2026-10-16");
    await expect(dunning.createDunning(actor, { ...input, level: 2 }, "2026-10-17")).rejects.toThrow(/Als Nächstes folgt „Letzte Mahnung“/);
    // Die letzte Stufe darf sich wiederholen
    expect((await dunning.createDunning(actor, { ...input, level: 3 }, "2026-10-17")).level).toBe(3);
  });

  it("lehnt Mahnungen vor Fälligkeit und mit Frist in der Vergangenheit ab", async () => {
    const input = { invoiceId, level: 1 as const, dueDate: "2026-09-20", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    await expect(dunning.createDunning(actor, input, "2026-09-10")).rejects.toThrow("noch nicht fällig");
    await expect(dunning.createDunning(actor, input, "2026-10-01")).rejects.toThrow("in der Zukunft");
  });
});
