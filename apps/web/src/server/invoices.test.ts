import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Rechnungen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
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

  const draft = (lines = [line(9500, 1900, 10_000)]) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-09-01",
    serviceTo: "2026-09-30",
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "DE987654321",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  it("Entwurf rechnet Summen und Fälligkeit", async () => {
    const created = await invoices.createDraft(actor, draft([line(9500, 1900, 10_000), line(10_000, 700)]));
    expect(created).toMatchObject({ net: 105_000, tax: 18_750, gross: 123_750, dueDate: "2026-10-16", number: null, status: "draft" });
  });

  it("Festschreiben vergibt lückenlose Nummern, erzeugt PDF und XML und bucht", async () => {
    await invoices.setNextNumber(actor, 2026, 34);
    const first = await invoices.createDraft(actor, draft());
    const second = await invoices.createDraft(actor, draft());

    const finalSecond = await invoices.finalizeInvoice(actor, second.id);
    const finalFirst = await invoices.finalizeInvoice(actor, first.id);
    expect(finalSecond.number).toBe("2026-034");
    expect(finalFirst.number).toBe("2026-035");

    expect(finalFirst.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(finalFirst.xml).toContain("2026-035");
    expect(finalFirst.buyer).toMatchObject({ name: "Nordwerk Software GmbH", kundennummer: "10001" });

    const lines = await sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_id = ${first.id} order by l.debit desc, l.account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual([
      ["1400", 113_050, 0, null],
      ["1766", 0, 18_050, "USt19"],
      ["8400", 0, 95_000, "USt19"],
    ]);
  }, 30_000);

  it("Festgeschriebenes ist unveränderlich", async () => {
    const d = await invoices.createDraft(actor, draft());
    const final = await invoices.finalizeInvoice(actor, d.id);
    await expect(sql`update invoices set note = 'x' where id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update invoice_lines set net = 1 where invoice_id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from journal_lines`).rejects.toThrow(/festgeschrieben/);
    await expect(invoices.updateDraft(actor, final.id, draft())).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update invoice_number_counters set last = 0`).rejects.toThrow(/zurückgesetzt/);
  }, 30_000);

  it("schlägt das Rendern fehl, entsteht keine Nummer", async () => {
    const d = await invoices.createDraft(actor, draft());
    await sql`update company set email = ''`;
    await expect(invoices.finalizeInvoice(actor, d.id)).rejects.toThrow(/E-Mail/);
    const [counter] = await sql`select count(*)::int as n from invoice_number_counters`;
    expect(counter?.n).toBe(0);
  });

  it("Storno hebt die Rechnung auf und bucht gegen", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-05");
    expect(storno).toMatchObject({ kind: "storno", gross: -113_050, correctsId: original.id, status: "final" });
    expect(storno.xml).toContain("381");

    const list = await invoices.listInvoices("2026-10-05");
    expect(list.find((i) => i.id === original.id)?.listStatus).toBe("storniert");
    await expect(invoices.cancelInvoice(actor, original.id, "2026-10-05")).rejects.toThrow(/bereits storniert/);

    const [balance] = await sql`select sum(debit) - sum(credit) as diff,
      sum(case when account = '1400' then debit - credit else 0 end) as forderungen from journal_lines`;
    expect(Number(balance?.diff)).toBe(0);
    expect(Number(balance?.forderungen)).toBe(0);
  }, 30_000);

  it("Rechnungskorrektur mindert den Betrag und muss negativ sein", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const correction = await invoices.createCorrection(actor, original.id, "2026-10-05");
    expect(correction).toMatchObject({ kind: "korrektur", status: "draft", gross: -113_050 });

    await invoices.updateDraft(actor, correction.id, { ...draft([line(-9500, 1900, 2000)]), paymentTermDays: 0 });
    const final = await invoices.finalizeInvoice(actor, correction.id);
    expect(final.gross).toBe(-22_610);

    const summary = await invoices.invoiceSummary("2026-10-05");
    expect(summary.openTotal).toBe(113_050 - 22_610);
  }, 30_000);

  it("Kontaktänderung legt Version an, Rechnung behält alte Anschrift", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const updated = await contacts.updateContact(actor, contactId, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Neue Straße 1",
      plz: "20095",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    expect(updated.version).toBe(2);
    const detail = await contacts.getContact(contactId);
    expect(detail?.versions.map((v) => v.version)).toEqual([2, 1]);
    const again = await invoices.getInvoice(final.id);
    expect((again?.invoice.buyer as { strasse: string }).strasse).toBe("Hafenstraße 5");
    await expect(sql`delete from contacts`).rejects.toThrow(/nur ergänzt/);
  }, 30_000);

  it("ZUGFeRD-PDF trägt das XML", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const pdf = final.pdf!.toString("latin1");
    expect(pdf).toMatch(/factur-x\.xml|zugferd-invoice\.xml/);
  }, 30_000);
});
