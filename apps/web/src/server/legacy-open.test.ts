import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

const PDF = new TextEncoder().encode("%PDF-1.4\n% RE1019 aus Lexoffice\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

describe.skipIf(!testDatabaseUrl)("Offene Posten aus Lexoffice (Postgres)", () => {
  let legacy: typeof import("./legacy-open.ts");
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let figures: typeof import("./vat-figures.ts");
  let storage: typeof import("./storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    legacy = await import("./legacy-open.ts");
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    figures = await import("./vat-figures.ts");
    storage = await import("./storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function legacyVoucher(values: {
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    net: number;
    tax: number;
    rate?: number;
    status?: string;
    openAmount?: number | null;
    file?: Uint8Array;
    mime?: string;
    contact?: string;
  }) {
    const rate = values.rate ?? 1900;
    const gross = values.net + values.tax;
    const payment =
      values.openAmount === null ? null : { status: "openRevenue", openAmount: values.openAmount ?? gross, paidDate: null, items: [] };
    const [contact] = values.contact ? await sql`select id from contacts where name = ${values.contact}` : [];
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${values.type}, ${values.direction}, ${values.number},
        ${values.date}, ${values.date}, ${values.status ?? "open"}, ${contact?.id ?? null}, ${values.contact ?? "Bürobedarf Schmidt KG"},
        ${values.net}, ${values.tax}, ${gross}, ${JSON.stringify([{ rate, net: values.net, tax: values.tax }])}::jsonb,
        ${JSON.stringify(values.direction === "ausgabe" ? [{ categoryId: "x", name: "Bürobedarf", rate, net: values.net, tax: values.tax }] : [])}::jsonb,
        ${payment ? JSON.stringify(payment) : null}::jsonb, ${JSON.stringify({ address: { name: values.contact ?? "" } })}::jsonb)
      returning id`;
    if (values.file) {
      const sha = await storage.storeFile(values.file);
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
        values (${row!.id}, ${values.mime === "application/pdf" ? "pdf" : "anhang"}, ${values.number + (values.mime === "application/pdf" ? ".pdf" : ".jpg")},
          ${values.mime ?? "application/pdf"}, ${sha}, ${values.file.byteLength})`;
    }
    return row!.id as string;
  }

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents,
      invoice_lines, invoices, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    await sql`insert into contacts (name, strasse, plz, ort) values ('Nordwerk Software GmbH', 'Hafenstraße 5', '20457', 'Hamburg')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  it("listet offene Posten mit Gründen, wenn etwas nicht geht", async () => {
    await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1019", date: "2026-09-20", net: 400_000, tax: 76_000, file: PDF, contact: "Nordwerk Software GmbH" });
    await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1020", date: "2026-09-21", net: 100_000, tax: 19_000, openAmount: 50_000, file: PDF });
    await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1018", date: "2026-08-01", net: 100_000, tax: 19_000, status: "paid", openAmount: 0, file: PDF });
    await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1021", date: "2026-09-22", net: 100_000, tax: 16_000, rate: 1600, file: PDF });
    await legacyVoucher({ type: "purchaseinvoice", direction: "ausgabe", number: "B-77", date: "2026-09-25", net: 10_000, tax: 1_900, openAmount: null });
    const items = await legacy.openLegacyItems();
    expect(items.map((i) => [i.number, i.open, i.blocker])).toEqual([
      ["RE1019", 476_000, null],
      ["RE1020", 50_000, expect.stringMatching(/teilweise bezahlt/)],
      ["RE1021", 116_000, "Steuersatz, den Haben nicht kennt"],
      ["B-77", 11_900, "keine Datei aus Lexoffice"],
    ]);
  });

  it("übernimmt eine offene Rechnung; Zahlung im Bankabgleich macht die Umsatzsteuer fällig (Ist)", async () => {
    const id = await legacyVoucher({
      type: "invoice", direction: "einnahme", number: "RE1019", date: "2026-09-20", net: 400_000, tax: 76_000, file: PDF, contact: "Nordwerk Software GmbH",
    });
    const result = await legacy.takeOverLegacyItem(actor, id);
    expect(result.kind).toBe("invoice");
    await expect(legacy.takeOverLegacyItem(actor, id)).rejects.toThrow(/Schon übernommen/);

    const [invoice] = await sql`select number, status, gross, pdf, locked_at, lexoffice_voucher_id from invoices where id = ${result.id}`;
    expect(invoice).toMatchObject({ number: "RE1019", status: "final", gross: 476_000, lexoffice_voucher_id: id });
    expect(Buffer.from(invoice!.pdf as Uint8Array).toString()).toContain("RE1019 aus Lexoffice");
    const lines = await sql`select account, debit, credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${result.id} order by account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1400", 476_000, 0],
      ["1766", 0, 76_000],
      ["9000", 0, 400_000],
    ]);
    expect((await invoices.listInvoices("2026-10-05")).find((i) => i.id === result.id)).toMatchObject({ listStatus: "ueberfaellig", open: 476_000 });

    // Die Zahlung im Oktober wird vorgeschlagen und macht die Steuer im Oktober fällig
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([["05.10.26", "05.10.26", "Gebucht", "Nordwerk Software GmbH", "Testfirma", "RE1019", "Eingang", "DE02100100100006820101", "4.760,00", "", "", ""]]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.suggestions[0]?.item).toMatchObject({ type: "invoice", id: result.id });
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: result.id, amount: 476_000 });
    const october = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(october).toMatchObject({ kz81: 400_000, tax81: 76_000 });
    const september = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(september.kz81).toBe(0);
  });

  it("Soll: die Rechnung zählt nicht noch einmal in der Voranmeldung", async () => {
    await sql`update company set versteuerung = 'soll'`;
    const id = await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1019", date: "2026-09-20", net: 400_000, tax: 76_000, file: PDF });
    const result = await legacy.takeOverLegacyItem(actor, id);
    const lines = await sql`select account, debit, credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${result.id} order by account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1400", 476_000, 0],
      ["9000", 0, 476_000],
    ]);
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz81).toBe(0);
    const [contact] = await sql`select name from contacts c join invoices i on i.contact_id = c.id where i.id = ${result.id}`;
    expect(contact!.name).toBe("Bürobedarf Schmidt KG");
  });

  it("übernimmt einen offenen Eingangsbeleg; die Vorsteuer zählt nicht doppelt", async () => {
    const id = await legacyVoucher({ type: "purchaseinvoice", direction: "ausgabe", number: "B-77", date: "2026-09-25", net: 10_000, tax: 1_900, file: JPEG, mime: "image/jpeg" });
    const results = await legacy.takeOverAll(actor);
    expect(results).toEqual([{ number: "B-77" }]);
    const [doc] = await sql`select id, status, category, gross, locked_at from documents where lexoffice_voucher_id = ${id}`;
    expect(doc).toMatchObject({ status: "gebucht", category: "buero", gross: 11_900 });
    expect(doc!.locked_at).not.toBeNull();
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
    expect((await bank.openItems()).map((i) => [i.type, i.id])).toEqual([["document", doc!.id]]);

    await bank.importStatement(
      actor,
      { bytes: dkbCsv([["30.09.26", "30.09.26", "Gebucht", "Testfirma", "Bürobedarf Schmidt KG", "B-77", "Ausgang", "DE02100100100006820101", "-119,00", "", "", ""]]), filename: "b.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc!.id, amount: -11_900 });
    expect(await bank.openItems()).toEqual([]);
    const [balance] = await sql`select sum(debit) - sum(credit) as saldo from journal_lines where account = '1600'`;
    expect(Number(balance!.saldo)).toBe(0);
  });
});
