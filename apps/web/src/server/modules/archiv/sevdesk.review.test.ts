import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe.skipIf(!testDatabaseUrl)("sevDesk-Abruf (Review)", () => {
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

  it("ein durch Neustart verwaister Lexoffice-Abruf (seit 10 Minuten ohne Fortschritt) blockiert den sevDesk-Abruf nicht", async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "2.0" } });
      return json({ objects: [] });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory(
      (o) => new importPkg.SevdeskClient({ ...o, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await sevdesk.saveSevdeskKey(actor, TOKEN);
    // Lexoffice-Abruf, dessen Prozess beim Neustart verschwand: steht noch auf „läuft“
    await sql`insert into lexoffice_imports (source, status, progress, started_at, updated_at)
      values ('lexoffice', 'laeuft', '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":0,"imported":0,"skipped":0,"files":0,"failed":[]}',
              now() - interval '10 minutes', now() - interval '10 minutes')`;
    await expect(sevdesk.startSevdeskImport(actor, { wait: true })).resolves.toBeTypeOf("string");
  });
});
