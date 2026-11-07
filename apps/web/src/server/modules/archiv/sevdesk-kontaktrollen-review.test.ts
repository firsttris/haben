import type { SevContact } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Review #347: Wer als Kunde angelegt wird, behält seine Kundennummer aus sevDesk – wie vor dem PR.
describe.skipIf(!testDatabaseUrl)("Review #347: Kundennummer bei Kunden-Ausgangsrolle (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  const contacts: SevContact[] = [
    { id: "3", name: "Neuer Partner", category: { id: "4" }, customerNumber: "1003" },
    { id: "5", name: "Ohne Kategorie", category: null, customerNumber: "1005" },
  ];

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith("/Tools/bookkeepingSystemVersion")
        ? { objects: { version: "2.0" } }
        : { objects: url.pathname.endsWith("/Contact") && url.searchParams.get("offset") === "0" ? contacts : [] };
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0 }));
    await sevdesk.saveSevdeskKey("review", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("übernimmt die sevDesk-Kundennummer, wenn der Kontakt als Kunde angelegt wird", async () => {
    await sevdesk.startSevdeskImport("review", { wait: true });
    const rows = await sql`select sevdesk_id, is_customer, kundennummer from contacts order by sevdesk_id`;
    expect(rows.map((r) => [r.sevdesk_id, r.is_customer, r.kundennummer])).toEqual([
      ["3", true, "1003"],
      ["5", true, "1005"],
    ]);
  });
});
