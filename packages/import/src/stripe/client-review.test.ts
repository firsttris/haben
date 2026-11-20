import { describe, expect, it } from "vitest";
import { StripeClient } from "./client.ts";

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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function client(responses: Response[], apiKey = "rk_live_abcdefghijklmnop") {
  const queue = [...responses];
  const fetchMock = (async () => queue.shift()!) as typeof fetch;
  return new StripeClient({ apiKey, fetch: fetchMock, sleep: async () => {} });
}

describe("Review StripeClient", () => {
  it("liefert eine Balance Transaction, die auf zwei Seiten steht, nur einmal (sonst lehnt der Importvertrag die ganze Lieferung ab)", async () => {
    const c = client([
      json({ object: "list", data: [txn("txn_a"), txn("txn_b")], has_more: true }),
      json({ object: "list", data: [txn("txn_b"), txn("txn_c")], has_more: false }),
    ]);
    const ids = (await c.balanceTransactions("2026-10-01", "2026-10-31")).map((t) => t.id);
    expect(ids).toEqual(["txn_a", "txn_b", "txn_c"]);
  });

  it("nennt auch dann keinen Teil des Schlüssels, wenn er in einem Rumpf ohne JSON an der Kürzungsgrenze von 300 Zeichen steht", async () => {
    const key = "rk_live_abcdefghijklmnop";
    const c = client([new Response(`${"x".repeat(290)}${key}`, { status: 400 })], key);
    const error = (await c.balanceTransactions("2026-10-01", "2026-10-31").catch((e: Error) => e)) as Error;
    expect(error.message).not.toContain("rk_live_ab");
  });

  it("liefert bei has_more mit leerer Seite, was da ist, und endet", async () => {
    const c = client([json({ object: "list", data: [txn("txn_a")], has_more: true }), json({ object: "list", data: [], has_more: true })]);
    expect((await c.balanceTransactions("2026-10-01", "2026-10-31")).map((t) => t.id)).toEqual(["txn_a"]);
  });

  it("meldet 500 und kaputtes JSON als Fehler ohne den Schlüssel", async () => {
    const key = "rk_live_abcdefghijklmnop";
    const a = (await client([json({ error: { message: `boom ${key}` } }, 500)], key)
      .balanceTransactions("2026-10-01", "2026-10-31")
      .catch((e: Error) => e)) as Error;
    expect(a.message).not.toContain(key);
    const b = (await client([new Response("<html>", { status: 200 })], key)
      .balanceTransactions("2026-10-01", "2026-10-31")
      .catch((e: Error) => e)) as Error;
    expect(b.message).toContain("kein JSON");
  });
});
