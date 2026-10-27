import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const INVOICES = [1, 2, 3].map((n) => ({
  id: String(100 + n),
  invoiceNumber: `RE-${n}`,
  invoiceDate: "2024-03-05",
  status: "200",
  invoiceType: "RE",
  sumNet: "100.00",
  sumTax: "19.00",
  sumGross: "119.00",
  paidAmount: 0,
}));

describe.skipIf(!testDatabaseUrl)("sevDesk-Abruf abbrechen (Postgres)", () => {
  let sevdesk: typeof import("./sevdesk.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("ein Abbruch während der Belege endet als abgebrochen, nicht als fertig mit lauter Fehlern", async () => {
    let cancelled = false;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
      if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "2.0" } });
      if (path === "/Invoice") return list(INVOICES);
      if (["/Contact", "/ContactAddress", "/CommunicationWay", "/CreditNote", "/Voucher"].includes(path)) return list([]);
      if (/^\/Invoice\/\d+\/getPositions$/.test(path)) {
        // Benutzer klickt beim ersten Beleg auf „Abbrechen“
        if (!cancelled) {
          cancelled = true;
          const [run] = await sql`select id from lexoffice_imports where status = 'laeuft'`;
          expect(sevdesk.cancelSevdeskImport(run!.id as string)).toBe(true);
        }
        return list([{ id: 1, taxRate: "19", sumNet: "100", sumTax: "19" }]);
      }
      return json({ error: { message: "nicht da" } }, 404);
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory(
      (o) => new importPkg.SevdeskClient({ ...o, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await sevdesk.saveSevdeskKey(actor, TOKEN);
    await sevdesk.startSevdeskImport(actor, { wait: true });
    const run = await sevdesk.latestSevdeskImport();
    expect({ status: run!.status, failed: run!.progress.failed.length }).toEqual({ status: "abgebrochen", failed: 0 });
  });
});
