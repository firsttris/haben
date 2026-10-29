import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Review: Storno und Korrektur (Postgres)", () => {
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
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
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

  it("Mehrere Korrekturen mindern eine Rechnung höchstens bis auf 0", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const first = await invoices.createCorrection(actor, original.id, "2026-10-05");
    await invoices.updateDraft(actor, first.id, { ...draft([line(-80_000)]), issueDate: "2026-10-05", paymentTermDays: 0 });
    await invoices.finalizeInvoice(actor, first.id);
    const second = await invoices.createCorrection(actor, original.id, "2026-10-06");
    await invoices.updateDraft(actor, second.id, { ...draft([line(-80_000)]), issueDate: "2026-10-06", paymentTermDays: 0 });
    // 1.000 € − 800 € − 800 € = −600 €: die Rechnung wäre unter 0 gemindert
    await expect(invoices.finalizeInvoice(actor, second.id)).rejects.toThrow();
  }, 60_000);

  it("Kleinunternehmer-Rechnung lässt sich nach dem Wechsel zur Regelbesteuerung noch stornieren", async () => {
    await sql`update company set kleinunternehmer = true`;
    const original = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, draft([line(100_000, 0)], { taxTreatment: "kleinunternehmer", issueDate: "2025-11-03" }))).id,
    );
    // Ausschalten geht jederzeit
    await sql`update company set kleinunternehmer = false`;
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-06");
    expect(storno).toMatchObject({ kind: "storno", status: "final", gross: -100_000, taxTreatment: "kleinunternehmer" });
  }, 60_000);
});
