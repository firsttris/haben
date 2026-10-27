import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Lexoffice-/sevDesk-Altbestand für KI-Assistenten (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate lexoffice_vouchers, lexoffice_imports cascade`;
    const [run] = await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb) returning id`;
    importId = run!.id as string;
  });

  it("findet einen sevDesk-Beleg über seine Kennung (lexoffice_id 'invoice/101'), die lexoffice_beleg selbst ausgibt", async () => {
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('invoice/101', 'sevdesk', ${importId}, 'invoice', 'einnahme', 'RE-1001', '2024-03-01', 'paid', 'Kunde', 10000, 1900, 11900,
        ${JSON.stringify([{ rate: 1900, net: 10000, tax: 1900 }])}::jsonb, '[]'::jsonb, null,
        ${JSON.stringify({ id: "101", invoiceNumber: "RE-1001", taxType: "default", taxRule: { id: "1" } })}::jsonb)`;
    const [byNumber] = await lexoffice.findLegacyVouchers("RE-1001");
    expect(byNumber!.voucher.lexofficeId).toBe("invoice/101");
    // dieselbe Kennung, die das Werkzeug als lexofficeId ausgibt, muss den Beleg wiederfinden
    const byId = await lexoffice.findLegacyVouchers("invoice/101");
    expect(byId.map((r) => r.voucher.number)).toEqual(["RE-1001"]);
  });

  it("nimmt bei nachZahlung nur Belege auf, die im Zeitraum tatsächlich bezahlt wurden (kein Skonto)", async () => {
    // Bezahlt im Februar, im März nur Skonto gebucht: trägt nach Ist nichts zum März bei
    await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('lx-skonto', ${importId}, 'invoice', 'einnahme', 'RE5', '2023-02-10', 'paid', 'Kunde', 10000, 1900, 11900,
        ${JSON.stringify([{ rate: 1900, net: 10000, tax: 1900 }])}::jsonb, '[]'::jsonb,
        ${JSON.stringify({
          status: "balanced",
          openAmount: 0,
          paidDate: "2023-03-02",
          items: [
            { type: "manualPayment", date: "2023-02-20", amount: 11662 },
            { type: "cashDiscount", date: "2023-03-02", amount: 238 },
          ],
        })}::jsonb,
        ${JSON.stringify({ taxConditions: { taxType: "net" } })}::jsonb)`;
    const march = await lexoffice.legacyVouchersForPeriod({ period: "2023-03", direction: "alle", search: "", withPayments: true, limit: 50 });
    // Der Beleg hat keine für Ist zählende Zahlung im März
    expect(march.vouchers[0]?.payments.filter((p) => p.date.startsWith("2023-03")) ?? []).toEqual([]);
    expect(march.total).toBe(0);
  });
});
