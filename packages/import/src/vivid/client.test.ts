import { describe, expect, it } from "vitest";
import { VividApiError, vividClient, vividZugangAbgelehnt } from "./client.ts";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function setup(handler: (call: Call, index: number) => Response, sleeps: number[] = []) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  const client = vividClient({
    apiKey: " vivid_sk_v1_geheim ",
    fetch: fetchFn,
    now: () => Date.UTC(2026, 10, 18, 12),
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { client, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fehler = (status: number, code: string) => json({ trace_id: "t-1", errors: [{ code, message: "text für Menschen" }] }, status);

const tx = (id: string) => ({ id, account_id: "acc-1", amount: "-1.00", currency: "EUR", state: "completed", show_at: "2026-11-01T10:00:00Z" });

describe("vividClient", () => {
  it("schickt den Schlüssel ohne Bearer und jeden Aufruf als POST mit JSON", async () => {
    const { client, calls } = setup(() => json({ status: "ok" }));
    await client.ping();
    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://api.prime.vivid.money/sme-integration/api/v1/ping",
        headers: expect.objectContaining({ authorization: "vivid_sk_v1_geheim", "content-type": "application/json" }),
        body: {},
      },
    ]);
  });

  it("folgt next_cursor mit denselben Filtern, auch über eine leere Seite hinweg, bis er fehlt", async () => {
    const pages = [
      { transactions: [tx("a"), tx("b")], next_cursor: "c1" },
      { transactions: [], next_cursor: "c2" },
      { transactions: [tx("c")], next_cursor: null },
    ];
    const { client, calls } = setup((_, i) => json(pages[i]));
    const result = await client.transactions("acc-1");
    expect(result.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.body)).toEqual([
      { account_ids: ["acc-1"], limit: 500 },
      { account_ids: ["acc-1"], limit: 500, cursor: "c1" },
      { account_ids: ["acc-1"], limit: 500, cursor: "c2" },
    ]);
    expect(calls[0]!.url).toBe("https://api.prime.vivid.money/sme-integration/api/v1/transactions/list");
  });

  it("wartet bei 429 die Zeit aus Retry-After und versucht es erneut", async () => {
    const sleeps: number[] = [];
    const { client, calls } = setup(
      (_, i) => (i === 0 ? json({ errors: [{ code: "rate_limited" }] }, 429, { "retry-after": "7" }) : json({ accounts: [] })),
      sleeps,
    );
    expect(await client.accounts()).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([7000]);
  });

  it("wiederholt einen abgelaufenen Schlüssel nicht und meldet ihn in Klartext", async () => {
    const { client, calls } = setup(() => fehler(401, "key_expired"));
    const error = await client.accounts().catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(VividApiError);
    expect(error).toMatchObject({ status: 401, code: "key_expired", message: "Der API-Schlüssel ist abgelaufen. Bitte in Vivid einen neuen anlegen." });
    expect(vividZugangAbgelehnt(error)).toBe(true);
  });

  it("meldet ein fehlendes Recht als abgelehnten Zugang, einen Serverfehler nicht", async () => {
    const scope = await setup(() => fehler(403, "scope_denied"))
      .client.transactions("acc-1")
      .catch((e: unknown) => e);
    expect(scope).toMatchObject({ message: "Dem API-Schlüssel fehlt ein Recht (accounts:read und transactions:read)." });
    expect(vividZugangAbgelehnt(scope)).toBe(true);
    const server = await setup(() => fehler(500, "internal_error"))
      .client.ping()
      .catch((e: unknown) => e);
    expect(server).toMatchObject({ status: 500, message: "HTTP 500 (internal_error)" });
    expect(vividZugangAbgelehnt(server)).toBe(false);
  });

  it("nennt die Meldung von Vivid nicht, sie kann den Schlüssel oder Daten enthalten", async () => {
    const error = await setup(() => json({ errors: [{ code: "invalid_request", message: "account_ids[0] must be a UUID" }] }, 400))
      .client.transactions("x")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ message: "HTTP 400 (invalid_request)" });
  });

  it("lehnt eine Antwort ohne Liste der Umsätze nicht ab, eine mit kaputtem Umsatz schon", async () => {
    expect(await setup(() => json({ next_cursor: null })).client.transactions("acc-1")).toEqual([]);
    const error = await setup(() => json({ transactions: [{ id: "a" }], next_cursor: null }))
      .client.transactions("acc-1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VividApiError);
  });

  it("verlangt einen Schlüssel", () => {
    expect(() => vividClient({ apiKey: "  " })).toThrow("API-Schlüssel fehlt");
  });
});
