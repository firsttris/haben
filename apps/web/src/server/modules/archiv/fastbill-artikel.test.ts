import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Artikel in der Form von article.get; Nummern, Namen und Preise erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";
const ARTICLES = [
  {
    ARTICLE_ID: "11",
    ARTICLE_NUMBER: "1001",
    TITLE: "Beratung",
    DESCRIPTION: "",
    UNIT: "Stunde",
    UNIT_PRICE: "90.00",
    CURRENCY_CODE: "EUR",
    VAT_PERCENT: "19.00",
    IS_GROSS: "0",
  },
  // brutto eingegeben: 100,00 € Endpreis, FastBill liefert den Nettopreis
  {
    ARTICLE_ID: "12",
    ARTICLE_NUMBER: "1002",
    TITLE: "Workshop-Paket",
    DESCRIPTION: "",
    UNIT: "",
    UNIT_PRICE: "84.0336",
    CURRENCY_CODE: "EUR",
    VAT_PERCENT: "19.00",
    IS_GROSS: "1",
  },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe.skipIf(!testDatabaseUrl)("Artikel aus FastBill (Postgres)", () => {
  let sql: postgres.Sql;
  let artikel: typeof import("./fastbill-artikel.ts");
  let zugang: typeof import("./fastbill-zugang.ts");
  let csv: typeof import("../datenimport/index.ts");
  let importPkg: typeof import("@haben/import");
  let services: string[];
  let articles: unknown[];
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    artikel = await import("./fastbill-artikel.ts");
    zugang = await import("./fastbill-zugang.ts");
    csv = await import("../datenimport/index.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  beforeEach(async () => {
    services = [];
    articles = ARTICLES;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== API) throw new Error(`unerwartet: ${String(input)}`);
      const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
      services.push(body.SERVICE);
      if (body.SERVICE === "customer.get") return json({ RESPONSE: { CUSTOMERS: [] } });
      if (body.SERVICE === "article.get") return json({ RESPONSE: { ARTICLES: articles.slice(body.OFFSET, body.OFFSET + 100) } });
      return json({ RESPONSE: { ERRORS: ["Unknown service"] } });
    }) as typeof fetch;
    // Ohne eigenes sleep: Der Abruf der Artikel bringt seins mit, das an der Stundengrenze abbricht statt zu warten
    zugang.setFastbillClientFactory((o) => new importPkg.FastbillClient({ fetch: fetchFn, minIntervalMs: 0, maxRetries: 0, ...o }));
    await sql`delete from lexoffice_imports where source = 'fastbill'`;
    await sql`delete from articles`;
    await sql`delete from fastbill_connection`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  const login = () => zugang.saveFastbillKey(actor, { email: "inhaber@example.de", apiKey: KEY, callsPerHour: 50 });
  const importCsv = (text: string) =>
    csv.runCsvImport(actor, new TextEncoder().encode(text), {
      kind: "artikel",
      encoding: "auto",
      delimiter: "auto",
      mapping: null,
      stichtag: null,
      confirm: [],
    });

  it("verlangt hinterlegte Zugangsdaten", async () => {
    await expect(artikel.fastbillArticlesCsv()).rejects.toThrow(/API-Schlüssel hinterlegen/);
    expect(services).toEqual([]);
  });

  it("liefert eine CSV, die der Artikel-Import ohne Zuordnung übernimmt, mit Endpreis bei brutto eingegebenen Artikeln; ein zweiter Import legt nichts doppelt an", async () => {
    await login();
    const result = await artikel.fastbillArticlesCsv();
    expect(result).toMatchObject({ count: 2, filename: "fastbill-artikel.csv" });
    expect(services.filter((s) => s === "article.get")).toHaveLength(1);

    expect(await importCsv(result.csv)).toEqual({ created: 2, duplicates: 0, failed: 0 });
    const rows = await sql`select number, description, unit, unit_price, price_includes_tax, tax_rate from articles order by number`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { number: "1001", description: "Beratung", unit: "Std.", unit_price: 9000, price_includes_tax: false, tax_rate: 1900 },
      { number: "1002", description: "Workshop-Paket", unit: "Stk.", unit_price: 10_000, price_includes_tax: true, tax_rate: 1900 },
    ]);

    await expect(importCsv((await artikel.fastbillArticlesCsv()).csv)).rejects.toThrow(/Nichts zu übernehmen/);
    expect(await sql`select count(*)::int as n from articles`).toEqual([{ n: 2 }]);
  });

  it("meldet einen leeren Artikelkatalog, statt eine leere Datei zu liefern", async () => {
    await login();
    articles = [];
    await expect(artikel.fastbillArticlesCsv()).rejects.toThrow(/keine Artikel/);
  });

  it("holt nichts, solange ein Abruf aus FastBill läuft", async () => {
    await login();
    await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'laeuft', '{}')`;
    await expect(artikel.fastbillArticlesCsv()).rejects.toThrow(/läuft/);
    expect(services).not.toContain("article.get");
  });

  it("wartet nicht eine Stunde in der Anfrage, wenn die Stundengrenze aus dem letzten Abruf erreicht ist", async () => {
    await login();
    const calls = Array.from({ length: 50 }, (_, i) => Date.now() - 60_000 + i);
    await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', ${JSON.stringify({ fastbillCalls: calls })}::jsonb)`;
    await expect(artikel.fastbillArticlesCsv()).rejects.toThrow(/Stundengrenze.*Minuten/);
    expect(services).not.toContain("article.get");
  });
});
