import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Zahlungssatz bei Storno und Korrektur (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/index.ts");
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate cash_entries, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, kleinunternehmer, iban)
      values (1, 'Musterwerk Testbetrieb', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', '', 'BY', true, 'DE89370400440532013000')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Beispielkunde",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "kunde@example.com",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function original(payment = 0) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-11-10",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "xrechnung-ubl",
      note: "",
      taxTreatment: "kleinunternehmer",
      lines: [{ description: "Beispielleistung", quantity: 1000, unit: "Psch.", unitPrice: 100, taxRate: 0 }],
    });
    const final = await invoices.finalizeInvoice(actor, draft.id);
    if (payment > 0) await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-11-11", amount: payment }, "2026-11-13");
    return final;
  }

  function textOf(pdf: Uint8Array) {
    return execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" }).replace(/\s+/g, " ");
  }

  it("sagt bei unbezahltem Storno in PDF und XML keine Erstattung zu", async () => {
    const invoice = await original();
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    const evidence = process.env.HABEN_716_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, "storno-unbezahlt.pdf"), storno.pdf!);
    }
    expect(textOf(storno.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
    expect(storno.xml).not.toContain("Der Betrag wird Ihnen erstattet.");
    const [preserved] = await sql`select pdf, xml from invoices where id = ${invoice.id}`;
    expect(preserved!.pdf).toEqual(invoice.pdf);
    expect(preserved!.xml).toBe(invoice.xml);
  });

  it.each([50, 100])("beschreibt bei %i Cent Zahlung das Guthaben ohne Erstattungszusage", async (payment) => {
    const invoice = await original(payment);
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    expect(textOf(storno.pdf!)).toContain("Nach dieser Stornierung verbleibt rechnerisch ein Guthaben zu Ihren Gunsten.");
    expect(storno.xml).toContain("Nach dieser Stornierung verbleibt rechnerisch ein Guthaben zu Ihren Gunsten.");
    expect(storno.xml).not.toContain("Bereits geleistete Zahlungen werden erstattet.");
    expect(textOf(storno.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
  });

  it("verspricht bei einer unbezahlten Rechnungskorrektur keine Auszahlung", async () => {
    const invoice = await original();
    const correction = await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, invoice.id, "2026-11-12")).id);
    expect(textOf(correction.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
    expect(correction.xml).not.toContain("Der Betrag wird Ihnen erstattet.");
  });
});
