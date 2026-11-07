import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Review #353: Beträge im sevdesk-Auftragsarchiv (Postgres)", () => {
  let sql: postgres.Sql;
  let orders: typeof import("./orders.ts");
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    orders = await import("./orders.ts");
    const [row] = await sql`insert into lexoffice_imports (source, status, progress)
      values ('sevdesk', 'fertig', '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":0,"imported":0,"skipped":0,"files":0,"failed":[]}') returning id`;
    importId = row!.id;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("ordnet einem USD-Auftrag die Fremdwährungsbeträge statt der Basisbeträge zu", async () => {
    const { SevdeskClient } = await import("@haben/import");
    const client = new SevdeskClient({
      apiKey: "review-token",
      minIntervalMs: 0,
      fetch: (async () => new Response(JSON.stringify({ objects: [] }), { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    // Model_OrderResponse: sum*ForeignCurrency sind die Summen in der Auftragswährung.
    // Quelle: https://api.sevdesk.de/openapi.yaml, Schema Model_OrderResponse.
    await orders.importOrder("review", importId, client, {
      id: "usd-order",
      orderType: "AN",
      orderNumber: "AN-USD-1",
      orderDate: "2026-10-01",
      status: "200",
      currency: "USD",
      sumNet: "100.00",
      sumTax: "19.00",
      sumGross: "119.00",
      sumNetForeignCurrency: "110.00",
      sumTaxForeignCurrency: "20.90",
      sumGrossForeignCurrency: "130.90",
    });

    const [document] = await sql`select currency, net, tax, gross from legacy_order_documents where external_id = 'usd-order'`;
    expect(document).toMatchObject({ currency: "USD", net: 11_000, tax: 2090, gross: 13_090 });
    expect(await orders.listOrderDocuments({ year: 2026, search: "AN-USD-1" })).toMatchObject([{ currency: "USD", gross: 13_090 }]);
  });

  it.each([
    { currency: "USD", foreign: {}, expected: { net: null, tax: null, gross: null } },
    {
      currency: "USD",
      foreign: { sumNetForeignCurrency: "0", sumTaxForeignCurrency: "0", sumGrossForeignCurrency: "0" },
      expected: { net: 0, tax: 0, gross: 0 },
    },
    {
      currency: "EUR",
      foreign: { sumNetForeignCurrency: "110", sumTaxForeignCurrency: "20.90", sumGrossForeignCurrency: "130.90" },
      expected: { net: 10_000, tax: 1900, gross: 11_900 },
    },
  ])("vermischt bei $currency weder fehlende Fremdwährungswerte noch Nullbeträge mit Basisbeträgen ($expected)", async ({ currency, foreign, expected }) => {
    const { SevdeskClient } = await import("@haben/import");
    const client = new SevdeskClient({
      apiKey: "review-token",
      minIntervalMs: 0,
      fetch: (async () => new Response(JSON.stringify({ objects: [] }), { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    const externalId = `currency-${currency}-${JSON.stringify(foreign)}`;
    await orders.importOrder("review", importId, client, {
      id: externalId,
      orderType: "AN",
      orderDate: "2026-10-01",
      status: "200",
      currency,
      sumNet: "100",
      sumTax: "19",
      sumGross: "119",
      ...foreign,
    });
    const [document] = await sql`select currency, net, tax, gross from legacy_order_documents where external_id = ${externalId}`;
    expect(document).toMatchObject({ currency, ...expected });
  });
});
