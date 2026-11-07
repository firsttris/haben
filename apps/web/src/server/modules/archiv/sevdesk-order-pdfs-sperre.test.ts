import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// TDD-Review #354: Ein Abweichen vor dem PDF-Abruf betrifft nur dieses Dokument; sevDesk wurde dabei nicht angefragt.
// docs/sevdesk.md: „Ein neuer Abruf lädt fehlende PDFs nach, soweit die Versions- und Quellstandsprüfung das erlauben.“
describe.skipIf(!testDatabaseUrl)("TDD-Review: geänderter Quellstand sperrt nur das eigene Auftrags-PDF (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let version = "2.0";
  const headers: Record<string, string> = { "geaendert-1": "Original", "unveraendert-2": "Original" };
  const calls: string[] = [];
  const source = (id: string) => ({
    id,
    orderType: "AN",
    orderNumber: `AN-${id}`,
    orderDate: "2026-10-01",
    status: "200",
    version: "0",
    update: "2026-10-01T10:00:00+02:00",
    currency: "EUR",
    sumNet: "100",
    sumTax: "19",
    sumGross: "119",
    header: headers[id],
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(path);
      const json = (objects: unknown) => new Response(JSON.stringify({ objects }), { headers: { "content-type": "application/json" } });
      if (path === "/Tools/bookkeepingSystemVersion") return json({ version });
      if (path === "/Order") return json(url.searchParams.get("offset") === "0" ? Object.keys(headers).map(source) : []);
      if (path.endsWith("/getPdf")) return json({ filename: "angebot.pdf", base64Encoded: true, content: Buffer.from(`%PDF-1.4 ${path}`).toString("base64") });
      if (/^\/Order\/[^/]+$/.test(path)) return json([source(path.split("/").at(-1)!)]);
      return json([]);
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lädt nach einem seit Archivierung geänderten Dokument die PDFs der übrigen Dokumente nach", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    headers["geaendert-1"] = "Später geänderter Kopftext";
    version = "1.0";
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });

    expect(calls).not.toContain("/Order/geaendert-1/getPdf");
    expect(calls).toContain("/Order/unveraendert-2/getPdf");
    const files = await sql`select d.external_id from legacy_order_files f join legacy_order_documents d on d.id = f.order_id`;
    expect(files.map((f) => f.external_id)).toEqual(["unveraendert-2"]);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([
      { lexofficeId: "order/geaendert-1", message: expect.stringContaining("seit Archivierung verändert") },
    ]);
  });
});
