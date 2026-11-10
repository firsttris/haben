import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Das Stornopaar gilt laut docs/sevdesk.md nur, „wenn zu beiden keine Zahlung besteht; sonst bleibt der Stand unklar“ (#472). */
describe.skipIf(!testDatabaseUrl)("Einzelzahlungen zu einem sevDesk-Stornopaar im Abruf (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./lexoffice.ts");
  let sevdesk: typeof import("./sevdesk.ts");
  let importPkg: typeof import("@haben/import");

  const TOKEN = "0123456789abcdef0123456789abcdef";
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const base = {
    objectName: "Invoice",
    status: "1000",
    paidAmount: 0,
    payDate: null,
    sumTax: "19.00",
    sumGross: "119.00",
    currency: "EUR",
    taxType: "default",
  };
  const original = { ...base, id: "9101", invoiceType: "RE", invoiceNumber: "RE-2025-0001", invoiceDate: "2025-04-08T00:00:00+02:00" };
  const stornorechnung = {
    ...base,
    id: "9102",
    invoiceType: "SR",
    invoiceNumber: "RE-2025-0002",
    invoiceDate: "2025-04-10T00:00:00+02:00",
    origin: { id: "9101", objectName: "Invoice" },
  };
  const log = {
    id: "8101",
    objectName: "CheckAccountTransactionLog",
    create: "2025-04-09T10:00:00+02:00",
    checkAccountTransaction: {
      id: "7101",
      objectName: "CheckAccountTransaction",
      valueDate: "2025-04-09T00:00:00+02:00",
      checkAccount: { id: "501", objectName: "CheckAccount" },
      deletedAt: null,
    },
    amountPaid: 119,
    bookingDate: "2025-04-09T00:00:00+02:00",
    object: { id: "9101", objectName: "Invoice" },
  };
  const position = { id: 1, taxRate: "19", sumNet: "100.00", sumTax: "19.00" };

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./lexoffice.ts");
    sevdesk = await import("./sevdesk.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: (async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            const path = url.pathname.replace(/^\/api\/v1/, "");
            const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
            switch (path) {
              case "/Tools/bookkeepingSystemVersion":
                return json({ objects: { version: "1.0" } });
              case "/Invoice":
                return list([original, stornorechnung]);
              case "/Invoice/9101/getPositions":
              case "/Invoice/9102/getPositions":
                return list([position]);
              case "/Contact":
              case "/ContactAddress":
              case "/CommunicationWay":
              case "/CreditNote":
              case "/Voucher":
              case "/Order":
                return list([]);
              case "/CheckAccount":
                return list([{ id: "501", name: "Geschäftskonto", currency: "EUR" }]);
              case "/CheckAccountTransactionLog":
                return list([log]);
            }
            return json({ error: { message: `unbekannt ${path}` } }, 404);
          }) as typeof fetch,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("holt die Einzelzahlung einer stornierten Rechnung ab und wertet das Paar dann nicht als storniert", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const payments = await sql`select p.external_id, p.amount from legacy_voucher_payments p
      join lexoffice_vouchers v on v.id = p.voucher_id where v.lexoffice_id = 'invoice/9101'`;
    expect(payments).toEqual([{ external_id: "8101", amount: 11_900 }]);
    const [row] = await sql`select id from lexoffice_vouchers where lexoffice_id = 'invoice/9101'`;
    const { voucher } = (await archive.legacyVoucherDetail(row!.id as string))!;
    expect(voucher.payment?.history).not.toBe("storno");
  });
});
