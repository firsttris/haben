import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Neue Teilleistung: Steuerzeitpunkt und Verfahrenswechsel (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contactId: string;
  const actor = "teilleistung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
  });
  afterAll(async () => { await sql?.end(); });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,ust_id,bundesland,iban,versteuerung,journal_ab)
      values (1,'Testfirma','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010',
      'DE123456789','BY','DE89370400440532013000','soll',2025)`;
    contactId = (await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg",
      land: "DE", email: "rechnung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    })).id;
  });

  const input = () => ({
    contactId, issueDate: "2026-12-01", serviceFrom: "2026-11-05", serviceTo: null, paymentTermDays: 14,
    format: "zugferd" as const, note: "", variant: "abschlag" as const, advanceType: "teilleistung" as const,
    lines: [{ description: "Teilleistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: 1900 as const }],
  });

  it("Reverse Charge behält auch bei Teilleistungen den besonderen Meldezeitpunkt nach Rechnungsdatum", async () => {
    const foreign = await contacts.createContact(actor, {
      kundennummer: "", name: "Muster GmbH", strasse: "Testgasse 1", plz: "1010", ort: "Wien", land: "AT",
      email: "rechnung@firma.example", ustId: "ATU12345678", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, { ...input(), contactId: foreign.id, taxTreatment: "reverse_charge",
      lines: [{ description: "Erbrachte Teilleistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 0 }],
    });
    await invoices.finalizeInvoice(actor, draft.id);
    expect(await vat.computeVatFigures({ year: 2026, month: 11 })).toMatchObject({ kz21: 0 });
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz21: 30_000 });
    expect((await reports.vatAbgleich({ year: 2026, month: 12 })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
  });

  it("eine unter Ist erbrachte Teilleistung bleibt nach dem Wechsel zu Soll bei Zahlung steuerpflichtig", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const old = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, {
      ...input(), variant: null, advanceType: null, issueDate: "2025-11-05", serviceFrom: "2025-11-05",
      lines: [{ description: "Frühere Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    })).id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: old.id, date: "2025-11-05", amount: 11_900 }, "2025-11-05");
    await contacts.saveCompany(actor, { ...await contacts.loadCompany(), versteuerung: "soll" }, "2026-01-01");
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, { ...input(), serviceFrom: "2025-11-20" })).id);
    expect(await vat.computeVatFigures({ year: 2025, month: 11 })).toMatchObject({ kz81: 10_000, tax81: 1_900 });
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz81: 0, tax81: 0 });
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    expect(await vat.computeVatFigures({ year: 2027, month: 1 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
    expect((await reports.vatAbgleich({ year: 2027, month: 1 })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
  });
});
