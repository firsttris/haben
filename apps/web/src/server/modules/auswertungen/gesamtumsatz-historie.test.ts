import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("Gesamtumsatz: historische Zahlungsquellen (Postgres)", () => {
  let sql: postgres.Sql;
  let read: typeof import("./gesamtumsatz.ts");
  let f: Awaited<ReturnType<typeof turnoverFixtures>>;
  beforeAll(async () => {
    sql = await setupTestDb();
    read = await import("./gesamtumsatz.ts");
  }, 30_000);
  beforeEach(async () => {
    f = await turnoverFixtures(sql);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function knownLegacy(amount = 11_900, date = "2026-05-05") {
    const v = await f.legacy("paid", { status: "balanced", openAmount: 0, paidDate: date, items: [] });
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, date, amount, raw)
      values (${v.id}, ${v.importId}, 'import', ${crypto.randomUUID()}, ${date}, ${amount}, '{}')`;
    return v;
  }
  it("liest belegte Einzelzahlung netto am Zahlungstag", async () => {
    await knownLegacy();
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 10_000, complete: true });
  });
  it("erhält das tatsächliche negative Vorzeichen einer belegten historischen Erstattung", async () => {
    const v = await f.legacy(
      "paid",
      { status: "balanced", openAmount: 0, paidDate: "2026-05-05", items: [] },
      {
        type: "creditnote",
        net: -10_000,
        tax: -1_900,
        gross: -11_900,
        taxes: JSON.stringify([{ rate: 1900, net: -10_000, tax: -1_900 }]),
      },
    );
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, date, amount, raw)
      values (${v.id}, ${v.importId}, 'import', ${crypto.randomUUID()}, '2026-05-05', -11900, '{}')`;
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: -10_000, complete: true });
  });
  it("liest einen nachgewiesenen unbezahlten sevDesk-Stornopaarstatus nicht als Zahlung", async () => {
    const payment = { status: "balanced", openAmount: 0, paidDate: null, items: [] };
    await f.legacy("paid", payment, {
      source: "sevdesk",
      lexoffice_id: "invoice/901",
      raw: JSON.stringify({ paidAmount: "0", payDate: "", taxRule: { id: "1" } }),
    });
    await f.legacy("paid", payment, {
      source: "sevdesk",
      lexoffice_id: "invoice/902",
      type: "creditnote",
      net: -10_000,
      tax: -1_900,
      gross: -11_900,
      taxes: JSON.stringify([{ rate: 1900, net: -10_000, tax: -1_900 }]),
      raw: JSON.stringify({ paidAmount: "0", payDate: "", invoiceType: "SR", origin: { id: "901", objectName: "Invoice" }, taxRule: { id: "1" } }),
    });
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true, items: [] });
  });
  it("addiert zu einer Archivzahlung keinen zweiten Zufluss aus dem unverbundenen DATEV-Originalstapel", async () => {
    await knownLegacy();
    const [file] = await sql`insert into archive_files (kind, year, filename, sha256, mime_type, size)
      values ('datev', 2026, 'Buchungsstapel.csv', ${crypto.randomUUID()}, 'text/csv', 1) returning id`;
    await sql`insert into datev_bookings (file_id, row, date, amount, side, account, contra_account, raw)
      values (${file!.id}, 1, '2026-05-05', 11900, 'S', '1200', '1400', '{}')`;
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 10_000, complete: false });
    expect(result.items).toContainEqual(expect.objectContaining({ source: "journal", net: null, occurredOn: null, decision: "unknown" }));
  });
  it("rechnet gemischte Zahlung/Rückbuchung des Altbestands nicht durch abs zu einem Zufluss um", async () => {
    const v = await knownLegacy(11_900);
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, date, amount, raw)
      values (${v.id}, ${v.importId}, 'import', ${crypto.randomUUID()}, '2026-06-05', -2380, '{}')`;
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
  it("zählt Altzahlungen vor Übernahme und native spätere Zahlung genau einmal", async () => {
    const v = await knownLegacy(5_950, "2026-03-05");
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, date, amount, raw)
      values (${v.id}, ${v.importId}, 'import', ${crypto.randomUUID()}, '2026-05-05', 5950, '{}')`;
    const invoice = await f.invoice();
    await sql`update invoices set lexoffice_voucher_id = ${v.id} where id = ${invoice}`;
    await f.journal("invoice", invoice, undefined, "2026-04-01");
    await f.allocate(await f.transaction(5_950, "2026-05-05"), invoice, 5_950);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 10_000, complete: true });
  });
  it("zeigt unvollständige eingebettete Lexoffice-Historie trotz bekanntem letzten Datum ungeklärt", async () => {
    await f.legacy(
      "paid",
      { status: "balanced", openAmount: 0, paidDate: "2026-05-05", items: [{ type: "partPaymentFinancialTransaction", date: "2026-05-05", amount: 5950 }] },
      { source: "lexoffice" },
    );
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
  it("deutet vatfree eines übernommenen Altbelegs nicht zur regulären Inlandsleistung um", async () => {
    const v = await f.legacy("open", { status: "open", openAmount: 11_900, paidDate: null, items: [] }, { raw: JSON.stringify({ taxType: "vatfree" }) });
    const invoice = await f.invoice();
    await sql`update invoices set lexoffice_voucher_id = ${v.id} where id = ${invoice}`;
    await f.allocate(await f.transaction(11_900), invoice, 11_900);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
  it("zeigt freie Ausgangs-/Verrechnungsbuchung ohne Leistungsnachweis als ungeklärt", async () => {
    await f.journal("manuell", crypto.randomUUID(), [
      { account: "1200", debit: 11_900, credit: 0, taxCode: null },
      { account: "8400", debit: 0, credit: 10_000, taxCode: "USt19" },
      { account: "1776", debit: 0, credit: 1_900, taxCode: "USt19" },
    ]);
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items).toContainEqual(expect.objectContaining({ source: "journal", decision: "unknown" }));
  });
  it("zählt Eröffnungsbuchung nicht als Zufluss", async () => {
    await f.journal("eroeffnung", crypto.randomUUID(), [
      { account: "1200", debit: 11_900, credit: 0, taxCode: null },
      { account: "9000", debit: 0, credit: 11_900, taxCode: null },
    ]);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true });
  });
  it("liest den bestätigten Zahlungsbezug eines Journalimports, nicht dessen Rechnungsdatum", async () => {
    const original = await f.journal(
      "import",
      crypto.randomUUID(),
      [
        { account: "1400", debit: 11_900, credit: 0, taxCode: null },
        { account: "8400", debit: 0, credit: 10_000, taxCode: "USt19" },
        { account: "1776", debit: 0, credit: 1_900, taxCode: "USt19" },
      ],
      "2025-10-01",
    );
    const payment = await f.journal("import", crypto.randomUUID(), [
      { account: "1200", debit: 11_900, credit: 0, taxCode: null },
      { account: "1400", debit: 0, credit: 11_900, taxCode: null },
    ]);
    const [o] = await sql`insert into external_imports (source, external_id, kind, payload_hash, entry_id, payload)
      values ('test', 'invoice', 'journal', 'a', ${original}, '{}') returning id`;
    const [p] = await sql`insert into external_imports (source, external_id, kind, payload_hash, entry_id, payload)
      values ('test', 'payment', 'journal', 'b', ${payment}, '{}') returning id`;
    await sql`insert into external_import_settlements (payment_import_id, original_import_id) values (${p!.id}, ${o!.id})`;
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items).toContainEqual(expect.objectContaining({ source: "journal", sourceId: payment, occurredOn: "2026-11-05", net: 10_000 }));
  });
});
