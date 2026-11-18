import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { json, sevdeskFakeFetch } from "./test-sevdesk-api.ts";

/*
 * Artikel aus sevDesk (GET /Part) im Abruf (#472): Anlage wie beim CSV-Import, Verknüpfung über die sevDesk-ID, kein
 * zweiter Artikel und kein Überschreiben bei einem neuen Abruf. Erfundene Artikel in der Form von Model_Part der OpenAPI.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";

const UNITIES = [
  { id: "1", objectName: "Unity", name: "Stk", translationCode: "UNITY_PIECE", uneceTradeUnitCode: "C62" },
  { id: "13", objectName: "Unity", name: "Tag(e)", translationCode: "UNITY_DAYS", uneceTradeUnitCode: "DAY" },
  { id: "11", objectName: "Unity", name: "%", translationCode: "UNITY_PERCENT", uneceTradeUnitCode: "C62" },
  { id: "900001", objectName: "Unity", name: "Jahr", translationCode: null, uneceTradeUnitCode: "ANN" },
];

function part(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    objectName: "Part",
    name: `Probeartikel ${id}`,
    partNumber: `P-${id}`,
    text: null,
    unity: { id: "1", objectName: "Unity" },
    price: "80.00",
    priceNet: "80.00",
    priceGross: "95.20",
    pricePurchase: null,
    taxRate: "19",
    status: "100",
    internalComment: null,
    stock: "0",
    stockEnabled: "0",
    image: null,
    ...over,
  };
}

const PARTS = [
  part("11", { text: "Zwei<br>Zeilen", internalComment: "intern" }),
  part("12", { unity: { id: "13", objectName: "Unity" }, status: "50", taxRate: "7", priceNet: "10.00", price: "10.00" }),
  part("13", { unity: { id: "11", objectName: "Unity" } }),
  part("14", { taxRate: "16" }),
  part("15", { partNumber: "ALT-7", name: "Anderer Name in sevDesk" }),
  part("16", { unity: { id: "900001", objectName: "Unity" }, pricePurchase: "40.00", stockEnabled: "1" }),
];

function fakeApi(options: { partFehler?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn = sevdeskFakeFetch(({ path, method, list, headers }) => {
    calls.push(`${method} ${path}`);
    if (headers.get("authorization") !== TOKEN) return json({ error: { message: "Authentication required" } }, 401);
    if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "2.0" } });
    if (path === "/Part") return options.partFehler ? json({ error: { message: "kaputt" } }, 500) : list(PARTS);
    if (path === "/Unity") return list(UNITIES);
    if (path.startsWith("/") && !path.slice(1).includes("/")) return list([]);
  });
  return { fetchFn, calls };
}

describe.skipIf(!testDatabaseUrl)("Artikel aus sevDesk (Postgres)", { timeout: 30_000 }, () => {
  let sevdesk: typeof import("./sevdesk.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";

  function installFakeApi(options: { partFehler?: boolean } = {}) {
    const api = fakeApi(options);
    sevdesk.setSevdeskClientFactory((o) => new importPkg.SevdeskClient({ ...o, fetch: api.fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }));
    return api;
  }

  async function run() {
    await sevdesk.startSevdeskImport(actor, { wait: true });
    return (await sevdesk.latestSevdeskImport())!;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    importPkg = await import("@haben/import");
    installFakeApi();
    await sevdesk.saveSevdeskKey(actor, TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt Artikel an, verknüpft einen vorhandenen mit gleicher Nummer und nennt nicht Übernommenes", async () => {
    await sql`insert into units (label, code) values ('Jahr', 'ANN')`;
    await sql`insert into articles (number, description, unit, unit_price, tax_rate) values ('alt-7', 'Bestand in Haben', 'Stk.', 5000, 1900)`;
    const api = installFakeApi();
    const result = await run();
    expect(result.status).toBe("fertig");
    expect(result.progress.sevdeskArticles).toEqual({ imported: 3, linked: 1, known: 0 });
    expect(result.progress.failed).toEqual([
      expect.objectContaining({ lexofficeId: "part/13", message: expect.stringContaining("Einheit „%“ gibt es in Haben nicht") }),
      expect.objectContaining({ lexofficeId: "part/14", message: "Artikel nicht übernommen: Steuersatz 16 %; Haben kennt 19, 7 und 0 %" }),
      expect.objectContaining({ lexofficeId: "part/ohne-feld/Einkaufspreis", message: expect.stringContaining("Einkaufspreis bei 1 Artikel") }),
      expect.objectContaining({ lexofficeId: "part/ohne-feld/Lagerbestand" }),
    ]);
    // Nur lesend
    expect(api.calls.every((c) => c.startsWith("GET "))).toBe(true);

    const rows = await sql`
      select sevdesk_id, number, description, detail, unit, unit_price, tax_rate, price_includes_tax, note, archived_at is not null as archived
      from articles order by number`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      // Verknüpft, nicht überschrieben
      {
        sevdesk_id: "15",
        number: "alt-7",
        description: "Bestand in Haben",
        detail: "",
        unit: "Stk.",
        unit_price: 5000,
        tax_rate: 1900,
        price_includes_tax: false,
        note: "",
        archived: false,
      },
      {
        sevdesk_id: "11",
        number: "P-11",
        description: "Probeartikel 11",
        detail: "Zwei\nZeilen",
        unit: "Stk.",
        unit_price: 8000,
        tax_rate: 1900,
        price_includes_tax: false,
        note: "intern",
        archived: false,
      },
      {
        sevdesk_id: "12",
        number: "P-12",
        description: "Probeartikel 12",
        detail: "",
        unit: "Tag",
        unit_price: 1000,
        tax_rate: 700,
        price_includes_tax: false,
        note: "",
        archived: true,
      },
      {
        sevdesk_id: "16",
        number: "P-16",
        description: "Probeartikel 16",
        detail: "",
        unit: "Jahr",
        unit_price: 8000,
        tax_rate: 1900,
        price_includes_tax: false,
        note: "",
        archived: false,
      },
    ]);
    // Die Anlage steht im Audit-Log wie jede andere
    const [audit] = await sql`select count(*)::int as n from audit_log where table_name = 'articles' and action = 'INSERT' and actor = ${actor}`;
    expect(audit!.n).toBeGreaterThanOrEqual(3);
  });

  it("legt bei einem neuen Abruf nichts doppelt an und überschreibt in Haben Geändertes nicht", async () => {
    await sql`update articles set description = 'In Haben geändert', unit_price = 9900 where sevdesk_id = '11'`;
    installFakeApi();
    const result = await run();
    expect(result.progress.sevdeskArticles).toEqual({ imported: 0, linked: 0, known: 4 });
    expect(result.progress.failed.map((f) => f.lexofficeId)).toEqual(["part/13", "part/14"]);
    const [count] = await sql`select count(*)::int as n from articles`;
    expect(count!.n).toBe(4);
    const [changed] = await sql`select description, unit_price from articles where sevdesk_id = '11'`;
    expect(changed).toEqual({ description: "In Haben geändert", unit_price: 9900 });
  });

  it("ein Fehler beim Abruf der Artikel hält den übrigen Abruf nicht auf", async () => {
    await leeren(sql)`truncate articles cascade`;
    installFakeApi({ partFehler: true });
    const result = await run();
    expect(result.status).toBe("fertig");
    expect(result.progress.failed).toEqual([expect.objectContaining({ lexofficeId: "part", number: "Artikel", message: expect.stringContaining("500") })]);
    expect(result.progress.sevdeskArticles).toBeUndefined();
  });
});
