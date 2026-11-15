import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Artikel aus FastBill und die Stundengrenze (Befunde aus dem Review von #1082); Daten erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";
const ARTICLE = {
  ARTICLE_ID: "11",
  ARTICLE_NUMBER: "1001",
  TITLE: "Beratung",
  DESCRIPTION: "",
  UNIT: "Stunde",
  UNIT_PRICE: "90.00",
  CURRENCY_CODE: "EUR",
  VAT_PERCENT: "19.00",
  IS_GROSS: "0",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe.skipIf(!testDatabaseUrl)("Artikel aus FastBill und die Stundengrenze (Postgres)", () => {
  let sql: postgres.Sql;
  let artikel: typeof import("./fastbill-artikel.ts");
  let zugang: typeof import("./fastbill-zugang.ts");
  let fastbill: typeof import("./fastbill.ts");
  let importPkg: typeof import("@haben/import");
  let services: string[];
  let respond: (service: string) => Response;
  let seenPreviousCalls: (readonly number[])[];
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    artikel = await import("./fastbill-artikel.ts");
    zugang = await import("./fastbill-zugang.ts");
    fastbill = await import("./fastbill.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  beforeEach(async () => {
    services = [];
    seenPreviousCalls = [];
    respond = (service) =>
      service === "article.get" ? json({ RESPONSE: { ARTICLES: [ARTICLE] } }) : json({ RESPONSE: { CUSTOMERS: [], CONTACTS: [], INVOICES: [], EXPENSES: [] } });
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== API) throw new Error(`unerwartet: ${String(input)}`);
      const body = JSON.parse(String(init?.body)) as { SERVICE: string };
      services.push(body.SERVICE);
      return respond(body.SERVICE);
    }) as typeof fetch;
    // Wie in Produktion (maxRetries Standard), nur ohne Mindestabstand
    zugang.setFastbillClientFactory((o) => {
      seenPreviousCalls.push(o.previousCalls ?? []);
      return new importPkg.FastbillClient({ fetch: fetchFn, minIntervalMs: 0, ...o });
    });
    await sql`delete from lexoffice_imports where source = 'fastbill'`;
    await sql`delete from fastbill_connection`;
    await zugang.saveFastbillKey(actor, { email: "inhaber@example.de", apiKey: KEY, callsPerHour: 50 });
    services = [];
  });

  afterAll(async () => {
    await sql?.end();
  });

  const lastRunWithCalls = (count: number) => {
    const calls = Array.from({ length: count }, (_, i) => Date.now() - 60_000 + i);
    return sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', ${JSON.stringify({ fastbillCalls: calls })}::jsonb)`;
  };

  it("zählt die Aufrufe eines Artikel-Abrufs beim nächsten Artikel-Abruf derselben Stunde mit", async () => {
    // 49 von 50 Aufrufen verbraucht: Der erste Artikel-Abruf nimmt den letzten, ein zweiter muss an der Grenze halten
    await lastRunWithCalls(49);
    await artikel.fastbillArticlesCsv();
    await expect(artikel.fastbillArticlesCsv()).rejects.toThrow(/Stundengrenze/);
    expect(services.filter((s) => s === "article.get")).toHaveLength(1);
  });

  it("zählt die Aufrufe eines Artikel-Abrufs beim anschließenden Abruf der Belege mit", async () => {
    await artikel.fastbillArticlesCsv();
    expect(services).toEqual(["article.get"]);
    seenPreviousCalls = [];
    await fastbill.startFastbillImport(actor, { wait: true });
    expect(seenPreviousCalls[0]).toHaveLength(1);
  });

  it("meldet eine Störung bei FastBill (503 mit Retry-After) nicht als erreichte Stundengrenze des Tarifs", async () => {
    respond = () => new Response("Service Unavailable", { status: 503, headers: { "retry-after": "120" } });
    const error = await artikel.fastbillArticlesCsv().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).not.toBeNull();
    expect(error!.message).not.toMatch(/Stundengrenze/);
  });
});
