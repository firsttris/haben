import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Review (#1237): Fälle, die der Abruf über storeBatch und das Modul stripe nicht verfehlen darf. */

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const bt = (
  id: string,
  iso: string,
  amount: number,
  fee: number,
  category = "charge",
  extra: Partial<StripeBalanceTransaction> = {},
): StripeBalanceTransaction => ({
  id,
  amount,
  created: ts(iso),
  currency: "eur",
  description: `Beleg ${id}`,
  fee,
  net: amount - fee,
  reporting_category: category,
  source: `ch_${id}`,
  type: category,
  ...extra,
});

let tick = 0;
const nowFn = () => new Date(Date.parse("2026-11-20T10:00:00Z") + ++tick * 1000);
const KEY = "rk_live_abcdefghijklmnop";
let imAbruf: StripeBalanceTransaction[] = [];
let aufrufe = 0;
const fake = (accountId = "acct_review") =>
  ({
    accountId: async () => accountId,
    balanceTransactions: async () => {
      aufrufe++;
      await new Promise((r) => setTimeout(r, 30));
      return imAbruf;
    },
    ohneZahlungsdetails: false,
  }) as unknown as StripeClient;

describe.skipIf(!testDatabaseUrl)("Review Stripe-Abruf (Postgres)", () => {
  let stripe: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "review";

  beforeAll(async () => {
    sql = await setupTestDb();
    stripe = await import("./index.ts");
    bank = await import("../bank/index.ts");
    stripe.setStripeClientFactory(() => fake());
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe', 'zahlungsdienstleister', 'stripe', 3)`;
    await stripe.saveStripeConnection(actor, { apiKey: KEY, fetchFrom: "2026-10-01" });
    // Erster Abruf legt die Quellenbindung an
    imAbruf = [bt("txn_start", "2026-10-02T08:00:00Z", 1000, 50)];
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    expect(r.added).toBe(2);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const reset = () => sql`update stripe_connections set fetch_from = '2026-10-01'`;
  const refs = async (like: string) =>
    (await sql`select bank_reference as r, amount from bank_transactions where bank_reference like ${like} order by bank_reference, amount`).map((r) => [
      r.r,
      Number(r.amount),
    ]);

  it("meldet eine Kategorie, die Haben nicht kennt, im Ergebnis des Abrufs (sie wird als Umsatz übernommen, der Zeitraum bleibt offen)", async () => {
    await reset();
    imAbruf = [bt("txn_topup", "2026-11-10T08:00:00Z", 5000, 0, "topup"), bt("txn_ok1", "2026-11-10T09:00:00Z", 2000, 0)];
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    expect(r.messages.join(" ")).toContain("Kategorie nicht unterstützt");
    expect(await refs("txn_topup%")).toEqual([["txn_topup", 5000]]);
    expect(await refs("txn_ok1%")).toEqual([["txn_ok1", 2000]]);
  });

  it("übernimmt Euro-Umsätze neben einer Fremdwährung und bucht die Fremdwährung nicht", async () => {
    await reset();
    imAbruf = [bt("txn_usd", "2026-11-12T08:00:00Z", 4000, 100, "charge", { currency: "usd" }), bt("txn_eur2", "2026-11-12T09:00:00Z", 1500, 0)];
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    expect(await refs("txn_usd%")).toEqual([]);
    expect(await refs("txn_eur2%")).toEqual([["txn_eur2", 1500]]);
  });

  it("legt Ereignisse mit gleichem Betrag am selben Tag getrennt an, in jeder Reihenfolge, und beim Wiederholen nichts", async () => {
    await reset();
    const a = bt("txn_g1", "2026-11-14T08:00:00Z", 999, 30, "charge", { description: "Abo" });
    const b = bt("txn_g2", "2026-11-14T08:00:00Z", 999, 30, "charge", { description: "Abo" });
    imAbruf = [a, b];
    expect((await stripe.syncStripe(actor, nowFn())).added).toBe(4);
    imAbruf = [b, a];
    await reset();
    expect((await stripe.syncStripe(actor, nowFn())).added).toBe(0);
    expect(await refs("txn_g%")).toHaveLength(4);
  });

  it("bildet Betrag 0 mit Gebühr, Zahlung ohne Gebühr und negative Gebühr ab; Summe der Umsätze gleich Summe der Netto-Werte", async () => {
    await reset();
    const list = [
      bt("txn_n0", "2026-11-15T08:00:00Z", 0, 200, "fee"),
      bt("txn_nofee", "2026-11-15T09:00:00Z", 700, 0),
      bt("txn_negfee", "2026-11-15T10:00:00Z", -1000, -30, "refund"),
    ];
    imAbruf = list;
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    const rows =
      await sql`select amount from bank_transactions where bank_reference like 'txn_n0%' or bank_reference like 'txn_nofee%' or bank_reference like 'txn_negfee%'`;
    expect(rows.reduce((s, x) => s + Number(x.amount), 0)).toBe(list.reduce((s, t) => s + t.net, 0));
  });

  it("klärt einen Konflikt bei der Gebühr mit „behalten“: danach nimmt der Abruf die neue Gebühr ohne weiteren Umsatz an", async () => {
    await reset();
    imAbruf = [bt("txn_k1", "2026-11-16T08:00:00Z", 5000, 100)];
    expect((await stripe.syncStripe(actor, nowFn())).added).toBe(2);
    imAbruf = [bt("txn_k1", "2026-11-16T08:00:00Z", 5000, 150)];
    await reset();
    expect((await stripe.syncStripe(actor, nowFn())).error).toContain("Konflikt");
    const [c] = (await stripe.stripeSummary()).konflikte.filter((k) => k.sourceEventId === "txn_k1");
    expect(c).toBeDefined();
    await bank.resolveConflict(actor, { conflictId: c!.id, decision: "keep" });
    await reset();
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    expect(r.added).toBe(0);
    expect(await refs("txn_k1%")).toEqual([
      ["txn_k1", 5000],
      ["txn_k1-gebuehr", -100],
    ]);
  });

  it("klärt einen Konflikt bei der Gebühr mit „übernehmen“: die zweite Gebühr kommt einmal, der Hauptbetrag bleibt einmal, der nächste Abruf legt nichts an", async () => {
    await reset();
    imAbruf = [bt("txn_k2", "2026-11-16T09:00:00Z", 5000, 100)];
    expect((await stripe.syncStripe(actor, nowFn())).added).toBe(2);
    imAbruf = [bt("txn_k2", "2026-11-16T09:00:00Z", 5000, 150)];
    await reset();
    expect((await stripe.syncStripe(actor, nowFn())).error).toContain("Konflikt");
    const [c] = (await stripe.stripeSummary()).konflikte.filter((k) => k.sourceEventId === "txn_k2");
    await bank.resolveConflict(actor, { conflictId: c!.id, decision: "add" });
    expect(await refs("txn_k2%")).toEqual([
      ["txn_k2", 5000],
      ["txn_k2-gebuehr", -150],
      ["txn_k2-gebuehr", -100],
    ]);
    await reset();
    const r = await stripe.syncStripe(actor, nowFn());
    expect(r.error).toBeNull();
    expect(r.added).toBe(0);
  });

  it("ruft bei gleichzeitigem Start nur einmal bei Stripe ab", async () => {
    await reset();
    imAbruf = [];
    aufrufe = 0;
    const [a, b] = await Promise.all([stripe.syncStripe(actor, nowFn()), stripe.syncStripe("anderer", nowFn())]);
    expect(aufrufe).toBe(1);
    expect(a).toBe(b);
  });

  it("lässt den Startpunkt stehen und meldet den Fehler, wenn der Abruf scheitert", async () => {
    await reset();
    stripe.setStripeClientFactory(
      () =>
        ({
          accountId: async () => "acct_review",
          balanceTransactions: async () => {
            throw new Error("Zugriff abgelehnt: kaputt");
          },
        }) as unknown as StripeClient,
    );
    try {
      const r = await stripe.syncStripe(actor, nowFn());
      expect(r.error).toContain("kaputt");
    } finally {
      stripe.setStripeClientFactory(() => fake());
    }
    const [row] = await sql`select fetch_from::text as f, last_error from stripe_connections`;
    expect(row!.f).toBe("2026-10-01");
    expect(row!.last_error).toContain("kaputt");
  });
});
