import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("MCP-Zugang für KI-Assistenten (Postgres)", () => {
  let mcp: typeof import("./index.ts");
  let server: typeof import("./server.ts");
  let tools: typeof import("./tools.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    mcp = await import("./index.ts");
    server = await import("./server.ts");
    tools = await import("./tools.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    server.resetRateLimitForTests();
    await sql`truncate mcp_calls, mcp_tokens, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '77815', 'Bühl', '35/123/45678', 'BW')`;
  });

  let nextId = 1;
  function rpc(token: string | null, method: string, params: Record<string, unknown> = {}, init: RequestInit = {}) {
    return server.handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        ...init,
      }),
    );
  }

  async function enabledToken(days: 30 | 90 | 365 = 30) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Claude Code", days })).token;
  }

  it("ist standardmäßig aus; Tokens gibt es erst nach dem Einschalten", async () => {
    expect(await mcp.mcpEnabled()).toBe(false);
    await expect(mcp.createMcpToken({ name: "Claude Code", days: 30 })).rejects.toThrow(/einschalten/);
  });

  it("speichert nur den Hash und zeigt das Token nur beim Anlegen", async () => {
    const token = await enabledToken();
    expect(token).toMatch(/^hb_[\w-]{40,}$/);
    const [row] = await sql`select token_hash, prefix, scopes from mcp_tokens`;
    expect(row!.token_hash).not.toContain(token.slice(3));
    expect(row!.prefix).toBe(token.slice(0, 7));
    expect(row!.scopes).toEqual(["haben:lesen"]);
    const [listed] = await mcp.listMcpTokens();
    expect(listed).toMatchObject({ name: "Claude Code", status: "aktiv", lastUsedAt: null });
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("lehnt fehlende, falsche, widerrufene und abgelaufene Tokens ab, ebenso bei ausgeschaltetem Zugang", async () => {
    const token = await enabledToken();
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await rpc("hb_falsch", "tools/list")).status).toBe(401);
    const unauthorized = await rpc("anders", "tools/list");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await rpc(token, "tools/list")).status).toBe(200);

    await mcp.setMcpEnabled(actor, false);
    expect((await rpc(token, "tools/list")).status).toBe(401);
    await mcp.setMcpEnabled(actor, true);

    const { id } = (await mcp.listMcpTokens())[0]!;
    await mcp.revokeMcpToken(id);
    expect((await rpc(token, "tools/list")).status).toBe(401);
    expect((await mcp.listMcpTokens())[0]!.status).toBe("widerrufen");

    const expired = await mcp.createMcpToken({ name: "Alt", days: 30 }, new Date(Date.now() - 31 * 86_400_000));
    expect((await rpc(expired.token, "tools/list")).status).toBe(401);
    expect((await mcp.listMcpTokens()).find((t) => t.name === "Alt")!.status).toBe("abgelaufen");
  });

  it("nimmt nur POST an, der Server hält keine Sitzungen", async () => {
    const token = await enabledToken();
    const response = await server.handleMcpRequest(new Request("http://localhost:3000/api/mcp", { method: "GET", headers: { Authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(405);
  });

  it("meldet sich mit Anweisungen an und bietet nur lesende Werkzeuge an", async () => {
    const token = await enabledToken();
    const init = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    const { result } = (await init.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(result.serverInfo.name).toBe("haben");
    expect(result.instructions).toContain("nur lesen");

    const list = (await (await rpc(token, "tools/list")).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["uebersicht", "fristen", "offene_posten", "umsatzsteuer_voranmeldung", "euer", "belege"]));
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect((await mcp.listMcpTokens())[0]!.lastUsedAt).not.toBeNull();
  });

  it("ruft Werkzeuge auf, protokolliert ohne Inhalte und meldet Eingabefehler", async () => {
    const token = await enabledToken();
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      ((await (await rpc(token, "tools/call", { name, arguments: args })).json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;

    const overview = await call("uebersicht");
    expect(overview.isError).toBeFalsy();
    const data = JSON.parse(overview.content[0]!.text) as { firma: string; voranmeldung: { link: string }; rechnungen: { offenSumme: number } };
    expect(data.firma).toBe("Testfirma");
    expect(data.rechnungen.offenSumme).toBe(0);
    expect(data.voranmeldung.link).toMatch(/^http:\/\/localhost:3000\/umsatzsteuer\/\d{4}-\d{2}$/);

    const vat = JSON.parse((await call("umsatzsteuer_voranmeldung", { zeitraum: "2026-09" })).content[0]!.text) as { zeitraum: string; faellig: string };
    expect(vat).toMatchObject({ zeitraum: "2026-09", faellig: "2026-10-12" });

    const wrong = await call("umsatzsteuer_voranmeldung", { zeitraum: "2026-13" });
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]!.text).toMatch(/Zeitraum „2026-13“ ungültig/);

    for (const name of ["fristen", "offene_posten", "ueberfaellige_rechnungen", "rechnungen", "belege", "bankumsaetze_ohne_zuordnung", "euer", "jahreserklaerung", "vorausgefuellte_belege"]) {
      expect((await call(name)).isError, name).toBeFalsy();
    }

    const calls = await mcp.recentMcpCalls(50);
    expect(calls[0]).toMatchObject({ client: "Claude Code", ok: true });
    expect(calls.find((c) => c.tool === "umsatzsteuer_voranmeldung" && !c.ok)).toBeDefined();
    const [columns] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'mcp_calls'`;
    expect(columns!.n).toBe(6);
  });

  it("begrenzt die Anfragen je Token", async () => {
    const token = await enabledToken();
    const { id } = (await mcp.listMcpTokens())[0]!;
    for (let i = 0; i < 120; i++) server.rateLimited(id);
    const limited = await rpc(token, "tools/list");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(server.rateLimited(id, Date.now() + 61_000)).toBe(false);
  });

  it("zählt jede Nachricht eines Batches gegen die Grenze", async () => {
    const token = await enabledToken();
    const batch = (n: number) =>
      server.handleMcpRequest(
        new Request("http://localhost:3000/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify(Array.from({ length: n }, () => ({ jsonrpc: "2.0", id: nextId++, method: "tools/list", params: {} }))),
        }),
      );
    expect((await batch(100)).status).toBe(200);
    expect((await batch(100)).status).toBe(429);
    expect((await batch(20)).status).toBe(200);
    expect((await rpc(token, "tools/list")).status).toBe(429);
  });

  it("nimmt den Monat der Voranmeldung nach dem Datum in Deutschland, nicht nach der Zeitzone des Servers", async () => {
    // 31.10.2026 23:30 UTC ist in Deutschland schon der 1. November: fällig ist dann der Oktober
    const context = tools.todayContext(new Date("2026-10-31T23:30:00Z"));
    const run = (name: string, args = {}) => tools.MCP_TOOLS.find((t) => t.name === name)!.run(args, context) as Promise<Record<string, unknown>>;
    const overview = await run("uebersicht");
    expect(overview.heute).toBe("2026-11-01");
    expect(overview.voranmeldung).toMatchObject({ zeitraum: "2026-10" });
    expect(await run("umsatzsteuer_voranmeldung")).toMatchObject({ zeitraum: "2026-10" });
  });

  it("schaltet das Ein und Aus ins Änderungsprotokoll", async () => {
    await mcp.setMcpEnabled(actor, true);
    const [entry] = await sql`select actor, new_value->>'mcp_enabled' as enabled from audit_log where table_name = 'company' order by id desc limit 1`;
    expect(entry).toMatchObject({ actor, enabled: "true" });
  });
});
