import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centsOf, PayPalApiError, PayPalClient } from "./client.ts";

type Row = { transaction_info: { transaction_initiation_date: string } };
const fixture = JSON.parse(readFileSync(new URL("../../test-fixtures/paypal/transaktionen.json", import.meta.url), "utf8")) as { transaction_details: Row[] };
const ID = "AaBbCcDdEeFf1234client";
const SECRET = "EsEcRetSecretWertGeheim5678";
const NOW = Date.parse("2026-11-07T10:00:00Z");

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Nachgebaute API: Anmeldung, Saldo (Kennung) und die Transaktionen aus der Fixture, nach Zeitraum und Seite geschnitten */
function api(options: { pageSize?: number; rows?: Row[]; respond?: (call: Call) => Response | undefined } = {}) {
  const calls: Call[] = [];
  const rows = options.rows ?? fixture.transaction_details;
  let tokens = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = { method: init?.method ?? "GET", url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    calls.push(call);
    const custom = options.respond?.(call);
    if (custom) return custom;
    if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: `token-${++tokens}`, token_type: "Bearer", expires_in: 3600 });
    if (url.pathname === "/v1/reporting/balances") return Response.json({ account_id: "BEISPIELHAENDLER1", balances: [] });
    const from = Date.parse(url.searchParams.get("start_date")!);
    const to = Date.parse(url.searchParams.get("end_date")!);
    const inWindow = rows.filter((r) => {
      const t = Date.parse(r.transaction_info.transaction_initiation_date.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
      return t >= from && t <= to;
    });
    const size = options.pageSize ?? Number(url.searchParams.get("page_size"));
    const page = Number(url.searchParams.get("page"));
    return Response.json({
      transaction_details: inWindow.slice((page - 1) * size, page * size),
      page,
      total_pages: Math.max(1, Math.ceil(inWindow.length / size)),
    });
  }) as typeof fetch;
  const client = (environment: "live" | "sandbox" = "live", baseUrl?: string) =>
    new PayPalClient({ clientId: ID, clientSecret: SECRET, environment, baseUrl, fetch: fetchFn, now: () => NOW, sleep: async () => {} });
  return { calls, client };
}

describe("PayPalClient", () => {
  it("meldet sich mit Client-ID und Secret an, nutzt das Token weiter und liefert die Kontokennung", async () => {
    const { calls, client } = api();
    const c = client();
    expect(await c.accountId()).toBe("BEISPIELHAENDLER1");
    expect(await c.accountId()).toBe("BEISPIELHAENDLER1");
    const tokenCalls = calls.filter((x) => x.url.pathname === "/v1/oauth2/token");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe("POST");
    expect(tokenCalls[0]!.url.origin).toBe("https://api-m.paypal.com");
    expect(tokenCalls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`${ID}:${SECRET}`).toString("base64")}`);
    expect(tokenCalls[0]!.body).toBe("grant_type=client_credentials");
    expect(calls.find((x) => x.url.pathname === "/v1/reporting/balances")!.headers.authorization).toBe("Bearer token-1");
  });

  it("nutzt für die Sandbox den Sandbox-Host", async () => {
    const { calls, client } = api();
    await client("sandbox").accountId();
    expect(new Set(calls.map((c) => c.url.origin))).toEqual(new Set(["https://api-m.sandbox.paypal.com"]));
  });

  it("fragt mit Basis-URL (nachgebaute API im E2E-Test) nur dort, auch bei der Sandbox", async () => {
    const { calls, client } = api();
    await client("sandbox", "http://127.0.0.1:3139/").transactions("2026-10-01", "2026-10-02");
    expect(new Set(calls.map((c) => c.url.origin))).toEqual(new Set(["http://127.0.0.1:3139"]));
    expect(calls.map((c) => c.url.pathname)).toEqual(["/v1/oauth2/token", "/v1/reporting/transactions"]);
  });

  it("erneuert das Token nach einem 401 einmal und wiederholt die Anfrage", async () => {
    let balances = 0;
    const { calls, client } = api({
      respond: (call) =>
        call.url.pathname === "/v1/reporting/balances" && ++balances === 1 ? Response.json({ name: "AUTHENTICATION_FAILURE" }, { status: 401 }) : undefined,
    });
    expect(await client().accountId()).toBe("BEISPIELHAENDLER1");
    expect(calls.filter((c) => c.url.pathname === "/v1/oauth2/token")).toHaveLength(2);
    expect(calls.filter((c) => c.url.pathname === "/v1/reporting/balances").at(-1)!.headers.authorization).toBe("Bearer token-2");
  });

  it("holt ein neues Token, wenn das alte abgelaufen ist", async () => {
    let now = NOW;
    const tokens: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/oauth2/token") {
        tokens.push("t");
        return Response.json({ access_token: "t", expires_in: 120 });
      }
      return Response.json({ account_id: "A1" });
    }) as typeof fetch;
    const c = new PayPalClient({ clientId: ID, clientSecret: SECRET, fetch: fetchFn, now: () => now, sleep: async () => {} });
    await c.accountId();
    now += 30_000;
    await c.accountId();
    expect(tokens).toHaveLength(1);
    // expires_in 120 s, eine Minute Reserve: nach 70 s ist es abgelaufen
    now += 40_000;
    await c.accountId();
    expect(tokens).toHaveLength(2);
  });

  it("liest die Felder der Transaction Search: Beträge in Cent mit Vorzeichen, Name, Bezug", async () => {
    const { client } = api();
    const list = await client().transactions("2026-10-01", "2026-10-31");
    expect(list).toHaveLength(10);
    const zahlung = list.find((t) => t.id === "9XY12345AB678901C")!;
    expect(zahlung).toMatchObject({
      eventCode: "T0006",
      status: "S",
      amount: 10_000,
      currency: "EUR",
      fee: -300,
      feeCurrency: "EUR",
      payerName: "Erika Beispiel",
      subject: "Bestellung 2026-117",
      invoiceId: "RE-2026-117",
    });
    const erstattung = list.find((t) => t.id === "8WV23456BC789012D")!;
    expect(erstattung).toMatchObject({ amount: -2_000, fee: 60, referenceId: "9XY12345AB678901C", referenceIdType: "TXN" });
    // Ohne `fee_amount`: keine Gebühr
    expect(list.find((t) => t.id === "7UT34567CD890123E")).toMatchObject({ fee: 0, feeCurrency: null });
    expect(list.find((t) => t.id === "1LK90123JK456789L")!.itemTitle).toBe("Lizenz");
  });

  it("holt alle Seiten und liefert eine Zeile, die auf zwei Seiten steht, einmal", async () => {
    const doppelt = [...fixture.transaction_details, fixture.transaction_details[0]!];
    const { calls, client } = api({ pageSize: 4, rows: doppelt });
    const list = await client().transactions("2026-10-01", "2026-10-27");
    expect(list).toHaveLength(10);
    expect(new Set(list.map((t) => t.id)).size).toBe(10);
    const pages = calls.filter((c) => c.url.pathname === "/v1/reporting/transactions").map((c) => c.url.searchParams.get("page"));
    expect(pages).toEqual(["1", "2", "3"]);
  });

  it("fragt nur Zeilen ab, die das Guthaben ändern, mit allen Feldern und höchstens 500 je Seite", async () => {
    const { calls, client } = api();
    await client().transactions("2026-10-01", "2026-10-27");
    const q = calls.find((c) => c.url.pathname === "/v1/reporting/transactions")!.url.searchParams;
    expect(q.get("fields")).toBe("all");
    expect(q.get("balance_affecting_records_only")).toBe("Y");
    expect(q.get("page_size")).toBe("500");
    expect(q.get("start_date")).toBe("2026-09-30T00:00:00Z");
    expect(q.get("end_date")).toBe("2026-10-29T00:00:00Z");
  });

  it("teilt einen langen Zeitraum in Fenster von höchstens 31 Tagen, lückenlos, und endet nicht nach jetzt", async () => {
    const { calls, client } = api();
    await client().transactions("2026-01-01", "2026-12-31");
    const windows = calls
      .filter((c) => c.url.pathname === "/v1/reporting/transactions")
      .map((c) => [Date.parse(c.url.searchParams.get("start_date")!), Date.parse(c.url.searchParams.get("end_date")!)] as const);
    expect(windows.length).toBeGreaterThan(8);
    for (const [start, end] of windows) expect(end - start).toBeLessThanOrEqual(31 * 86_400_000);
    for (let i = 1; i < windows.length; i++) expect(windows[i]![0]).toBe(windows[i - 1]![1]);
    expect(windows.at(-1)![1]).toBe(NOW - (NOW % 1000));
  });

  it("nennt bei 403 das Recht Transaction Search, ohne Zugangsdaten", async () => {
    const { client } = api({
      respond: (call) =>
        call.url.pathname === "/v1/reporting/transactions"
          ? Response.json(
              {
                name: "NOT_AUTHORIZED",
                message: `Authorization failed due to insufficient permissions. ${call.headers.authorization}`,
                details: [{ issue: "PERMISSION_DENIED" }],
              },
              { status: 403 },
            )
          : undefined,
    });
    const error = await client()
      .transactions("2026-10-01", "2026-10-31")
      .catch((e) => e);
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error.status).toBe(403);
    expect(error.message).toContain("Transaction Search");
    expect(error.message).not.toContain("token-1");
  });

  it("meldet falsche Zugangsdaten bei der Anmeldung, ohne Client-ID, Secret oder deren Base64-Form zu nennen", async () => {
    const basic = Buffer.from(`${ID}:${SECRET}`).toString("base64");
    // Der Rumpf wiederholt die Zugangsdaten und ist lang: auch ein Stück an der Kürzungsgrenze darf nicht bleiben
    const rumpf = `${"x".repeat(250)}${SECRET} ${ID} ${basic}`;
    const { client } = api({ respond: (call) => (call.url.pathname === "/v1/oauth2/token" ? new Response(rumpf, { status: 401 }) : undefined) });
    const error = await client()
      .accountId()
      .catch((e) => e);
    expect(error.message).toContain("Anmeldung abgelehnt");
    for (const geheim of [SECRET, ID, basic, SECRET.slice(0, 6), basic.slice(0, 12)]) expect(error.message).not.toContain(geheim);
    const { client: zweiter } = api({
      respond: (call) =>
        call.url.pathname === "/v1/oauth2/token"
          ? Response.json({ error: "invalid_client", error_description: `Client Authentication failed ${SECRET}` }, { status: 401 })
          : undefined,
    });
    const zweiterFehler = await zweiter()
      .accountId()
      .catch((e) => e);
    expect(zweiterFehler.message).toContain("Client Authentication failed");
    expect(zweiterFehler.message).not.toContain(SECRET);
  });

  it("wiederholt bei 429 nach Retry-After und meldet nach drei Wiederholungen die Ratenbegrenzung", async () => {
    let versuche = 0;
    const waits: number[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "t", expires_in: 3600 });
      versuche++;
      return versuche <= 2 ? new Response("{}", { status: 429, headers: { "retry-after": "7" } }) : Response.json({ account_id: "A1" });
    }) as typeof fetch;
    const c = new PayPalClient({ clientId: ID, clientSecret: SECRET, fetch: fetchFn, now: () => NOW, sleep: async (ms) => void waits.push(ms) });
    expect(await c.accountId()).toBe("A1");
    expect(waits).toEqual([7000, 7000]);
    const immer = new PayPalClient({
      clientId: ID,
      clientSecret: SECRET,
      fetch: (async (input: string | URL | Request) =>
        String(input).includes("oauth2") ? Response.json({ access_token: "t" }) : new Response("", { status: 429 })) as typeof fetch,
      sleep: async () => {},
    });
    await expect(immer.accountId()).rejects.toThrow("Zu viele Abrufe");
  });

  it("meldet einen Netzwerkfehler als Fehler der API mit Status 0", async () => {
    const c = new PayPalClient({
      clientId: ID,
      clientSecret: SECRET,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      sleep: async () => {},
    });
    const error = await c.accountId().catch((e) => e);
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error.status).toBe(0);
    expect(error.message).not.toContain(SECRET);
  });

  it("verlangt Client-ID und Secret", () => {
    expect(() => new PayPalClient({ clientId: " ", clientSecret: SECRET })).toThrow("Client-ID");
  });
});

describe("centsOf", () => {
  it("rechnet ohne Gleitkomma", () => {
    expect(centsOf("-1.10", "x")).toBe(-110);
    expect(centsOf("0.07", "x")).toBe(7);
    expect(centsOf("1234", "x")).toBe(123_400);
    expect(centsOf("19.9", "x")).toBe(1_990);
    expect(centsOf("2.500", "x")).toBe(250);
  });
  it("lehnt Unbrauchbares und echte Bruchteile von Cent ab", () => {
    expect(() => centsOf("1,10", "x")).toThrow();
    expect(() => centsOf("0.005", "x")).toThrow();
  });
});
