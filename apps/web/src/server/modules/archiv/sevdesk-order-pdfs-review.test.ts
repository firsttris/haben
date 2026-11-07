import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("TDD-Review: Quellstand beim Nachladen von Auftrags-PDFs (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let version = "2.0";
  let serial = 0;
  let externalId: string;
  let content: Record<string, unknown>;
  let pdfFailure = 0;
  let afterFailure = 0;
  let requested = false;
  const calls: string[] = [];
  const source = () => ({
    id: externalId,
    orderType: "AN",
    orderNumber: `AN-${externalId}`,
    orderDate: "2026-10-01",
    status: "100",
    version: "0",
    update: "2026-10-01T10:00:00+02:00",
    currency: "EUR",
    sumNet: "100",
    sumTax: "19",
    sumGross: "119",
    ...content,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(path);
      const json = (objects: unknown, status = 200) => new Response(JSON.stringify({ objects }), { status, headers: { "content-type": "application/json" } });
      if (path === "/Tools/bookkeepingSystemVersion") return json({ version });
      if (path === "/Order") return json(url.searchParams.get("offset") === "0" ? [source()] : []);
      if (path.endsWith("/getPdf")) {
        requested = true;
        return json(
          { filename: "angebot.pdf", base64Encoded: true, content: Buffer.from("%PDF-1.4 aktueller Quellstand").toString("base64") },
          pdfFailure || 200,
        );
      }
      if (/^\/Order\/[^/]+$/.test(path)) return json([source()], requested && afterFailure ? afterFailure : 200);
      return json([]);
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  beforeEach(() => {
    externalId = `review-${++serial}`;
    version = "2.0";
    content = {};
    pdfFailure = 0;
    afterFailure = 0;
    requested = false;
    calls.length = 0;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it.each(["ergänzt", "entfernt"])("ordnet nachträglich %sen Kopftext keinem alten Archivstand zu", async (change) => {
    content = change === "entfernt" ? { header: "Ursprünglicher Kopftext" } : {};
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [archived] = await sql`select raw from legacy_order_documents where external_id = ${externalId}`;
    expect(archived!.raw.order).toEqual(source());

    content = change === "ergänzt" ? { header: "Nachträglich ergänzter Kopftext" } : {};
    version = "1.0";
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });

    expect(calls.filter((path) => path.endsWith("/getPdf"))).toHaveLength(0);
    expect(
      (
        await sql`select count(*)::int as n from legacy_order_files f join legacy_order_documents d on d.id = f.order_id where d.external_id = ${externalId}`
      )[0]!.n,
    ).toBe(0);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([{ message: expect.stringContaining("seit Archivierung verändert") }]);
  });
});
