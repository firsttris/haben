import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Unvollständige sevDesk-Zahlungshistorie (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let voucherId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const [run] = await sql`insert into lexoffice_imports (source, status, progress) values ('sevdesk', 'fertig', '{}') returning id`;
    // Altbestand vor dem Fix: zwei reale Raten wurden als eine Zahlung im November gespeichert.
    const payment = { status: "balanced", openAmount: 0, paidDate: "2026-11-15", items: [{ type: "manualPayment", date: "2026-11-15", amount: 119000 }] };
    const [v] = await sql`insert into lexoffice_vouchers
      (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('invoice/100', 'sevdesk', ${run!.id}, 'invoice', 'einnahme', 'RE-100', '2026-10-01', 'paid', 'Kunde', 100000, 19000, 119000,
      '[{"rate":1900,"net":100000,"tax":19000}]', '[]', ${JSON.stringify(payment)}::jsonb, '{"taxType":"default"}') returning id`;
    voucherId = v!.id as string;
  }, 30_000);

  afterAll(async () => { await sql?.end(); });

  it("sperrt den Ist-Monatsabgleich statt die ganze Steuer dem letzten Zahlungsmonat zuzuordnen", async () => {
    const year = (await archive.reconciliation()).years.find((y) => y.year === 2026)!;
    expect(year.vat).toEqual([]);
    expect(year).toHaveProperty("vatIssue", expect.stringMatching(/Zahlungshistorie/));
    expect(year.ready).toBe(false);
  });

  it("zeigt einen unklaren Stichtag und lehnt auch die direkte Übernahme ab", async () => {
    const item = (await legacy.openLegacyItems("2026-10-31")).find((v) => v.id === voucherId)!;
    expect(item.blocker).toMatch(/Zahlungshistorie/);
    await expect(legacy.takeOverLegacyItem("test-user", voucherId, "2026-10-31")).rejects.toThrow(/Zahlungshistorie/);
  });

  it("gibt die frühere Verdichtung nicht mehr als echte Einzelzahlung in der Detailansicht aus", async () => {
    const detail = (await archive.legacyVoucherDetail(voucherId))!;
    expect(detail.voucher.payment!.items).toEqual([]);
    expect(detail.voucher).toHaveProperty("paymentHistoryIssue", expect.stringMatching(/Zahlungshistorie/));
  });

  it("sperrt die zahlungsbezogene Belegsuche für Assistenten statt unvollständige Monatsdaten zu liefern", async () => {
    await expect(archive.legacyVouchersForPeriod({ period: "2026-10", direction: "alle", search: "", withPayments: true, limit: 100 }))
      .rejects.toThrow(/Zahlungshistorie/);
  });
});
