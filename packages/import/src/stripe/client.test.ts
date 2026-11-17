import { describe, expect, it } from "vitest";
import { StripeApiError, StripeClient } from "./client.ts";

const txn = (id: string) => ({
  id,
  object: "balance_transaction",
  amount: 100,
  created: 1_790_000_000,
  currency: "eur",
  fee: 0,
  net: 100,
  type: "charge",
  reporting_category: "charge",
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(responses: Response[] | ((url: URL) => Response)) {
  const calls: { url: URL; auth: string | null }[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const fetchMock = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
    return queue ? queue.shift()! : (responses as (url: URL) => Response)(u);
  }) as typeof fetch;
  const sleeps: number[] = [];
  return { calls, sleeps, client: new StripeClient({ apiKey: "rk_test_beispiel", fetch: fetchMock, sleep: async (ms) => void sleeps.push(ms) }) };
}

describe("StripeClient", () => {
  it("verlangt einen Schlüssel", () => {
    expect(() => new StripeClient({ apiKey: " " })).toThrow();
  });

  it("holt alle Seiten mit starting_after und begrenzt auf die Tage in UTC", async () => {
    const { client: c, calls } = client([
      json({ object: "list", data: [txn("txn_a"), txn("txn_b")], has_more: true }),
      json({ object: "list", data: [txn("txn_c")], has_more: false }),
    ]);
    const all = await c.balanceTransactions("2026-10-01", "2026-10-31");
    expect(all.map((t) => t.id)).toEqual(["txn_a", "txn_b", "txn_c"]);
    expect(calls[0]!.auth).toBe("Bearer rk_test_beispiel");
    expect(calls[0]!.url.pathname).toBe("/v1/balance_transactions");
    expect(calls[0]!.url.searchParams.get("created[gte]")).toBe(String(Date.UTC(2026, 9, 1) / 1000));
    // Der 31. gehört mit; die Obergrenze ist der Beginn des 1. November
    expect(calls[0]!.url.searchParams.get("created[lt]")).toBe(String(Date.UTC(2026, 10, 1) / 1000));
    expect(calls[0]!.url.searchParams.get("starting_after")).toBeNull();
    expect(calls[1]!.url.searchParams.get("starting_after")).toBe("txn_b");
  });

  it("klappt die Zahlung auf und liefert bei Erstattung und Streit die Balance Transaction der Zahlung", async () => {
    const refund = { ...txn("txn_r"), type: "refund", source: { id: "re_1", object: "refund", charge: { id: "ch_1", balance_transaction: "txn_c" } } };
    const payout = { ...txn("txn_p"), type: "payout", source: { id: "po_1", object: "payout" } };
    const plain = { ...txn("txn_c"), source: "ch_1" };
    const { client: c, calls } = client([json({ object: "list", data: [refund, payout, plain], has_more: false })]);
    const all = await c.balanceTransactions("2026-10-01", "2026-10-31");
    expect(calls[0]!.url.searchParams.get("expand[]")).toBe("data.source.charge");
    expect(all.map((t) => [t.id, t.source, t.relatedTransactionId])).toEqual([
      ["txn_r", "re_1", "txn_c"],
      ["txn_p", "po_1", undefined],
      ["txn_c", "ch_1", undefined],
    ]);
  });

  it("liefert die Konto-ID", async () => {
    const { client: c } = client([json({ id: "acct_beispiel", object: "account" })]);
    expect(await c.accountId()).toBe("acct_beispiel");
  });

  it("wiederholt bei 429 nach Retry-After und gibt bei anderen Fehlern die Meldung von Stripe weiter", async () => {
    const { client: c, sleeps } = client([
      json({ error: { message: "slow down" } }, 429, { "retry-after": "2" }),
      json({ object: "list", data: [], has_more: false }),
    ]);
    expect(await c.balanceTransactions("2026-10-01", "2026-10-31")).toEqual([]);
    expect(sleeps).toEqual([2000]);

    const { client: bad } = client([json({ error: { message: "Invalid API Key provided: rk_test_****" } }, 401)]);
    await expect(bad.balanceTransactions("2026-10-01", "2026-10-31")).rejects.toMatchObject({
      status: 401,
      message: "Zugriff abgelehnt: Invalid API Key provided: rk_test_****",
    });
  });

  it("meldet eine unerwartete Antwort", async () => {
    const { client: c } = client([json({ data: [{ id: "txn_a" }], has_more: false })]);
    await expect(c.balanceTransactions("2026-10-01", "2026-10-31")).rejects.toBeInstanceOf(StripeApiError);
  });
});
