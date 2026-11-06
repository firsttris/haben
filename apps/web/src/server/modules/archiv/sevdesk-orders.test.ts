import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("sevdesk-Auftragsarchiv ohne Buchungswirkung (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  const calls: string[] = [];

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(path);
      const orders = ["AN", "AB", "LI"].map((orderType, i) => ({
        id: String(i + 1),
        orderType,
        orderNumber: `${orderType}-2026-1`,
        orderDate: "2026-10-01",
        status: "200",
        address: "Archivkunde",
        currency: "EUR",
        sumNet: "100",
        sumTax: "19",
        sumGross: "119",
        origin: null,
      }));
      const objects =
        path === "/Tools/bookkeepingSystemVersion"
          ? { version: "1.0" }
          : path === "/Order"
            ? url.searchParams.get("offset") === "0"
              ? [...orders, { ...orders[0], id: "4", status: "100" }]
              : []
            : path.endsWith("/getPositions")
              ? [{ id: "1", name: "Leistung", quantity: "2", price: "50", taxRate: "19" }]
              : [];
      return new Response(JSON.stringify({ objects }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("archiviert die drei fertigen Auftragsarten mit Positionen und erhält die Finanzbücher unverändert", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls).toContain("/Order");
    const orders = await sql`select kind, number, raw from legacy_order_documents order by external_id`;
    expect(orders.map((o) => o.kind)).toEqual(["AN", "AB", "LI"]);
    expect(orders[0]!.raw.positions).toMatchObject([{ name: "Leistung", quantity: "2", price: "50" }]);
    for (const table of ["lexoffice_vouchers", "invoices", "quotes", "journal_entries", "allocations"]) {
      expect(Number((await sql.unsafe(`select count(*) as n from ${table}`))[0]!.n)).toBe(0);
    }
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
  });

  it("erzeugt beim erneuten Abruf keine doppelten Archivdokumente", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(Number((await sql`select count(*) as n from legacy_order_documents`)[0]!.n)).toBe(3);
  });

  it("schützt Archivdokumente vor Überschreiben und Löschen", async () => {
    await expect(sql`update legacy_order_documents set number = 'geändert'`).rejects.toThrow();
    await expect(sql`delete from legacy_order_documents`).rejects.toThrow();
  });
});
