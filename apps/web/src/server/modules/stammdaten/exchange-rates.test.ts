import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const CSV_2026 = "Land;Währung;Januar;Februar;März;April;Mai;Juni;Juli;August;September;Oktober;November;Dezember\nUSA;1 Euro;;;;;;;;1,0950 USD;1,0812 USD;;;\n";

describe.skipIf(!testDatabaseUrl)("Umrechnungskurse (Postgres)", () => {
  let rates: typeof import("./exchange-rates.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    rates = await import("./exchange-rates.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate exchange_rates, document_amounts, documents cascade`;
    delete (globalThis as { __habenKurseAbgerufen?: number }).__habenKurseAbgerufen;
  });

  const fakeFetch = (body: string, status = 200) =>
    vi.fn(async (url: string | URL | Request) => {
      void url;
      return new Response(body, { status });
    }) as unknown as typeof fetch;

  it("ruft die Kurse des BMF ab; der amtliche Kurs ersetzt einen von Hand eingetragenen; alles im Audit-Log", async () => {
    await rates.storeExchangeRates(actor, [{ currency: "USD", month: "2026-09", rate: "1.08" }], "manuell");
    const fetchImpl = fakeFetch(CSV_2026);
    const result = await rates.refreshExchangeRates(actor, "2026-10-02", fetchImpl);
    expect(result).toMatchObject({ added: 1, changed: 1, fetched: 2, latest: "2026-09" });
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toContain("uu-kurse-2026-csv.csv");
    expect(await rates.rateForMonth("USD", "2026-09")).toMatchObject({ rate: "1.081200", source: "bmf" });
    const audit = await sql`select action from audit_log where table_name = 'exchange_rates' order by seq`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "INSERT", "UPDATE"]);
  });

  it("im Januar auch das Vorjahr; 404 heißt noch nichts veröffentlicht, andere Fehler werden gemeldet", async () => {
    const fetchImpl = fakeFetch("", 404);
    expect(await rates.refreshExchangeRates(actor, "2027-01-03", fetchImpl)).toMatchObject({ added: 0, latest: null });
    expect(vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]).match(/uu-kurse-(\d{4})/)![1])).toEqual(["2026", "2027"]);
    await expect(rates.refreshExchangeRates(actor, "2026-10-02", fakeFetch("", 500))).rejects.toThrow(/HTTP 500/);
  });

  it("Scheduler: ohne Fremdwährung kein Abruf; sonst einmal am Tag, bis die Kurse des Vormonats da sind", async () => {
    const fetchImpl = fakeFetch(CSV_2026);
    expect(await rates.runDueExchangeRates("2026-10-02", Date.now(), fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    await sql`insert into documents (filename, mime_type, size, sha256, currency) values ('a.pdf', 'application/pdf', 1, 'x', 'USD')`;
    expect(await rates.runDueExchangeRates("2026-10-02", Date.now(), fetchImpl)).toMatchObject({ added: 2 });
    // Am selben Tag nicht noch einmal, und mit den Kursen für September auch am nächsten Tag nicht
    expect(await rates.runDueExchangeRates("2026-10-02", Date.now(), fetchImpl)).toBeNull();
    expect(await rates.runDueExchangeRates("2026-10-03", Date.now() + 25 * 60 * 60 * 1000, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
