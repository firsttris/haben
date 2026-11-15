import { mapFbExpense, mapFbInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Belege in der Form, wie der FastBill-Umzug sie ablegt (mapFbInvoice/mapFbExpense); Beträge und Namen erfunden.
// Ist-Versteuerung: Umsatz zählt im Monat der Zahlung (§ 13 Abs. 1 Nr. 1 Buchst. b UStG); die Vorsteuer im Monat des
// Belegs, unabhängig von der Zahlung (§ 15 Abs. 1 Satz 1 Nr. 1 UStG).
const BASE = {
  SUBTYPE: "standard",
  IS_CANCELED: "0",
  CURRENCY_CODE: "EUR",
  VAT_CASE: "0",
  SUB_TOTAL: 1000,
  VAT_TOTAL: 190,
  TOTAL: 1190,
  VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 1000, VAT_VALUE: 190 }],
};

const PAID_WITH_PAYMENTS = mapFbInvoice({
  ...BASE,
  INVOICE_ID: "9101",
  TYPE: "outgoing",
  STATE: "paid",
  INVOICE_NUMBER: "2025-1",
  INVOICE_DATE: "2025-03-20",
  PAID_DATE: "2025-04-02 00:00:00",
  PAYMENTS: [{ PAYMENT_ID: "1", DATE: "02.04.2025", AMOUNT: "1190.00", CURRENCY_CODE: "EUR", NOTE: "", TYPE: "Bank" }],
});
// Bezahlt, aber ohne Einzelzahlungen: nur PAID_DATE
const PAID_WITHOUT_PAYMENTS = mapFbInvoice({
  ...BASE,
  INVOICE_ID: "9102",
  TYPE: "outgoing",
  STATE: "paid",
  INVOICE_NUMBER: "2025-2",
  INVOICE_DATE: "2025-03-25",
  PAID_DATE: "2025-05-06 00:00:00",
  PAYMENTS: [],
});
// Am Stichtag offen, danach bezahlt: kommt als offener Posten nach Haben
const OPEN_AT_CUTOFF = mapFbInvoice({
  ...BASE,
  INVOICE_ID: "9103",
  TYPE: "outgoing",
  STATE: "paid",
  INVOICE_NUMBER: "2025-3",
  INVOICE_DATE: "2025-12-10",
  PAID_DATE: "2026-01-15 00:00:00",
  PAYMENTS: [{ PAYMENT_ID: "2", DATE: "15.01.2026", AMOUNT: "1190.00", CURRENCY_CODE: "EUR", NOTE: "", TYPE: "Paypal" }],
});
const EXPENSE = mapFbExpense({
  INVOICE_ID: "9201",
  ORGANIZATION: "Bürobedarf Beispiel",
  CATEGORY: [],
  INVOICE_NUMBER: "L-1",
  INVOICE_DATE: "2025-03-28",
  PAID_DATE: "2025-04-10 00:00:00",
  CURRENCY_CODE: "EUR",
  SUB_TOTAL: 100,
  VAT_TOTAL: 19,
  TOTAL: 119,
  VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 100, VAT_VALUE: 19 }],
});

describe.skipIf(!testDatabaseUrl)("FastBill-Altbestand bei Ist und Soll (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  const ids = new Map<string, string>();

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const [run] = await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', '{}') returning id`;
    for (const { voucher, payment } of [PAID_WITH_PAYMENTS, PAID_WITHOUT_PAYMENTS, OPEN_AT_CUTOFF, EXPENSE]) {
      const [row] = await sql`insert into lexoffice_vouchers
        (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
        values (${voucher.lexofficeId}, 'fastbill', ${run!.id}, ${voucher.type}, ${voucher.direction}, ${voucher.number}, ${voucher.date},
        ${voucher.status}, ${voucher.contactName}, ${voucher.net}, ${voucher.tax}, ${voucher.gross}, ${JSON.stringify(voucher.taxes)}::jsonb,
        ${JSON.stringify(voucher.categories)}::jsonb, ${JSON.stringify(payment)}::jsonb, '{"VAT_CASE":"0"}'::jsonb) returning id`;
      ids.set(voucher.lexofficeId, row!.id as string);
      // Original-PDF: Ohne Datei lässt sich ein offener Posten nicht übernehmen
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
        values (${row!.id}, 'pdf', 'rechnung.pdf', 'application/pdf', ${"0".repeat(63) + String(ids.size)}, 1)`;
    }
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("zählt den Umsatz bei Ist im Monat der Zahlung, auch ohne Einzelzahlungen, die Vorsteuer im Monat des Belegs", async () => {
    const year = (await archive.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue).toBeNull();
    const month = (m: string) => year.vat.find((v) => v.month === m);
    expect(month("2025-03")).toMatchObject({ kz81: 0, kz66: 1900 });
    expect(month("2025-04")).toMatchObject({ kz81: 100_000, tax81: 19_000 });
    expect(month("2025-05")).toMatchObject({ kz81: 100_000, tax81: 19_000 });
  });

  it.each(["SKR03", "SKR04"])("zählt bei Soll nach Belegdatum (%s)", async (kontenrahmen) => {
    await sql`update company set versteuerung = 'soll', kontenrahmen = ${kontenrahmen} where id = 1`;
    try {
      const year = (await archive.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.vat.find((v) => v.month === "2025-03")).toMatchObject({ kz81: 200_000, tax81: 38_000, kz66: 1900 });
    } finally {
      await sql`update company set versteuerung = 'ist', kontenrahmen = 'SKR03' where id = 1`;
    }
  });

  it("zeigt im Abgleich je Jahr, wenn Ausgaben noch auf ihren Beleg aus dem Browser-Skript warten", async () => {
    await sql`insert into fastbill_receipts (expense_id, status, number, date, supplier, gross, document_url)
      values ('9301', 'wartet', 'L-2', '2025-06-01', 'Lieferant', 1190, 'https://my.fastbill.com/download/x')`;
    try {
      const year = (await archive.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.checks).toContainEqual({ ok: false, label: "Keine Ausgabe wartet auf ihren Beleg", detail: "1 Ausgabe aus FastBill wartet" });
      expect(year.ready).toBe(false);
    } finally {
      await sql`delete from fastbill_receipts`;
    }
    const year = (await archive.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.checks.map((c) => c.label)).not.toContain("Keine Ausgabe wartet auf ihren Beleg");
  });

  it.each([
    ["ist", "SKR03"],
    ["ist", "SKR04"],
    ["soll", "SKR03"],
    ["soll", "SKR04"],
  ])("bietet eine am Stichtag offene und danach bezahlte Rechnung als offenen Posten an (%s, %s)", async (versteuerung, kontenrahmen) => {
    await sql`update company set versteuerung = ${versteuerung}, kontenrahmen = ${kontenrahmen} where id = 1`;
    try {
      const items = await legacy.openLegacyItems("2025-12-31");
      const item = items.find((v) => v.id === ids.get("fastbill/invoice/9103"));
      expect(item).toMatchObject({ blocker: null });
      expect(items.find((v) => v.id === ids.get("fastbill/invoice/9101"))).toBeUndefined();
    } finally {
      await sql`update company set versteuerung = 'ist', kontenrahmen = 'SKR03' where id = 1`;
    }
  });
});
