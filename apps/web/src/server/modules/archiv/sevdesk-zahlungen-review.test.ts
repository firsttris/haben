import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Review #348: payDate ist das letzte Zahldatum. Keine Zahlung eines sevDesk-Belegs liegt danach;
// Monate und Stichtage nach dem letzten Zahldatum sind also nicht unklar.
describe.skipIf(!testDatabaseUrl)("Review #348: Reichweite der Sperre (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const [sev] = await sql`insert into lexoffice_imports (source, status, progress) values ('sevdesk', 'fertig', '{}') returning id`;
    const [lex] = await sql`insert into lexoffice_imports (source, status, progress) values ('lexoffice', 'fertig', '{}') returning id`;
    // sevDesk 2024: vollständig bezahlt, letztes Zahldatum 20.03.2024 (so wie der PR neu importiert)
    const sevPayment = { status: "balanced", openAmount: 0, paidDate: null, items: [] };
    await sql`insert into lexoffice_vouchers
      (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('invoice/1', 'sevdesk', ${sev!.id}, 'invoice', 'einnahme', 'SD-1', '2024-03-01', 'paid', 'Kunde', 10000, 1900, 11900,
      '[{"rate":1900,"net":10000,"tax":1900}]', '[]', ${JSON.stringify(sevPayment)}::jsonb,
      '{"taxType":"default","status":"1000","paidAmount":119,"payDate":"2024-03-20T00:00:00+01:00"}')`;
    // Lexoffice 2025: echte Einzelzahlung im Mai 2025
    const lexPayment = { status: "balanced", openAmount: 0, paidDate: "2025-05-10", items: [{ type: "manualPayment", date: "2025-05-10", amount: 23800 }] };
    await sql`insert into lexoffice_vouchers
      (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('lex-1', 'lexoffice', ${lex!.id}, 'invoice', 'einnahme', 'LX-1', '2025-05-02', 'paid', 'Kunde', 20000, 3800, 23800,
      '[{"rate":1900,"net":20000,"tax":3800}]', '[]', ${JSON.stringify(lexPayment)}::jsonb, '{"taxType":"net"}')`;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("rechnet den Ist-Abgleich für ein Jahr nach dem letzten sevDesk-Zahldatum weiter", async () => {
    const year = (await archive.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue).toBeNull();
    expect(year.vat.find((m) => m.month === "2025-05")).toMatchObject({ kz81: 20000, tax81: 3800 });
  });

  it("liefert dem Assistenten Zahlungen eines Zeitraums nach dem letzten sevDesk-Zahldatum", async () => {
    const { vouchers } = await archive.legacyVouchersForPeriod({ period: "2025-05", direction: "alle", search: "", withPayments: true, limit: 100 });
    expect(vouchers.map((v) => v.number)).toEqual(["LX-1"]);
  });

  it("zeigt eine vor dem Stichtag vollständig bezahlte sevDesk-Rechnung nicht als offenen Posten", async () => {
    const items = await legacy.openLegacyItems("2024-12-31");
    expect(items.map((i) => i.number)).not.toContain("SD-1");
  });
});
