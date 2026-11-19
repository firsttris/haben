import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abruf der Balance Transactions von Stripe gegen Postgres: Zugang speichern, Umsätze abrufen, ins Konto des
 * Zahlungsdienstleisters übernehmen, beim zweiten Lauf nichts doppelt anlegen und mit dem CSV-Export zusammenspielen
 * (#1280, #306).
 *
 * Der Stripe-Client ist nachgebaut (setStripeClientFactory); die Balance Transactions stammen aus einem Testkonto von
 * Stripe (packages/import/test-fixtures/stripe), die Kennungen sind erfunden.
 */

const transactions: StripeBalanceTransaction[] = JSON.parse(
  readFileSync(new URL("../../../../../../packages/import/test-fixtures/stripe/sandbox-balance-transactions.json", import.meta.url), "utf8"),
);
/** Nach der letzten Bewegung (06.11.2026) */
const HEUTE = new Date("2026-11-07T10:00:00Z");
const KEY = "rk_live_abcdefghijklmnop";

/** Was der nachgebaute Zugang beim nächsten Abruf liefert */
let imAbruf: StripeBalanceTransaction[] = transactions;

const fake = (accountId = "acct_beispiel") => ({ accountId: async () => accountId, balanceTransactions: async () => imAbruf }) as unknown as StripeClient;

/** Dieselben Balance Transactions als Zeilen des Exports „Balance history“ */
function csv(): Uint8Array {
  const euro = (cents: number) => (cents / 100).toFixed(2);
  const rows = transactions.map((t) =>
    [
      t.id,
      new Date(t.created * 1000).toISOString().slice(0, 19).replace("T", " "),
      t.reporting_category ?? t.type,
      euro(t.amount),
      euro(t.fee),
      euro(t.net),
      t.currency,
      t.description ?? "",
    ].join(","),
  );
  return new TextEncoder().encode(["balance_transaction_id,created_utc,reporting_category,gross,fee,net,currency,description", ...rows].join("\n"));
}

describe.skipIf(!testDatabaseUrl)("Stripe-Abruf (Postgres)", () => {
  let stripe: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    stripe = await import("./index.ts");
    bank = await import("../bank/index.ts");
    stripe.setStripeClientFactory(() => fake());
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function kontoAnlegen() {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe', 'zahlungsdienstleister', 'stripe', 3) on conflict do nothing`;
    const [konto] = await sql`select id from bank_accounts where provider = 'stripe'`;
    return konto!.id as string;
  }

  it("speichert den Schlüssel verschlüsselt und nennt in der Zusammenfassung nur die Kontokennung und die letzten Zeichen", async () => {
    await stripe.saveStripeConnection(actor, { apiKey: KEY, fetchFrom: "2019-01-01" });
    const stand = await stripe.stripeSummary();
    expect(stand).toMatchObject({
      configured: true,
      accountId: "acct_beispiel",
      keyHint: "mnop",
      testmodus: false,
      fetchFrom: "2019-01-01",
      rhythmus: "taeglich",
    });
    expect(JSON.stringify(stand)).not.toContain("abcdefgh");
    const [row] = await sql`select ciphertext::text as c from stripe_connections`;
    expect(row!.c).not.toContain("abcdefgh");
  });

  it("lehnt den öffentlichen Schlüssel, unbekannte Werte und einen Start in der Zukunft ab", async () => {
    await expect(stripe.saveStripeConnection(actor, { apiKey: "pk_live_abcdefghijklmnop", fetchFrom: "2019-01-01" })).rejects.toThrow("pk_");
    await expect(stripe.saveStripeConnection(actor, { fetchFrom: "2019-01-01", rhythmus: "minuetlich" as "taeglich" })).rejects.toThrow();
    await expect(stripe.saveStripeConnection(actor, { fetchFrom: "2999-01-01" })).rejects.toThrow("Zukunft");
    // Ohne neuen Schlüssel bleibt der gespeicherte
    await stripe.saveStripeConnection(actor, { fetchFrom: "2019-01-01", rhythmus: "woechentlich" });
    expect((await stripe.stripeSummary()).rhythmus).toBe("woechentlich");
    await stripe.saveStripeConnection(actor, { fetchFrom: "2019-01-01", rhythmus: "taeglich" });
  });

  it("legt ohne Konto des Dienstleisters nichts an und lässt den Startpunkt stehen", async () => {
    const result = await stripe.syncStripe(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.accountName).toBeNull();
    expect(result.messages.join(" ")).toContain("noch kein Konto");
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(0);
    const [row] = await sql`select fetch_from::text as f from stripe_connections`;
    expect(row!.f).toBe("2019-01-01");
  });

  it("übernimmt die Umsätze ins Konto des Dienstleisters, Zahlung und Gebühr getrennt", async () => {
    await kontoAnlegen();
    const result = await stripe.syncStripe(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.entries).toBe(6);
    expect(result.accountName).toBe("Stripe");
    // Drei Zahlungen mit Gebühr, ein Streit mit Streitgebühr, eine Erstattung und eine Auszahlung
    expect(result.added).toBe(10);
    const umsaetze = await sql`select bank_reference, amount from bank_transactions order by bank_reference`;
    const betrag = (ref: string) => Number(umsaetze.find((u) => u.bank_reference === ref)!.amount);
    const [zahlung] = transactions.filter((t) => t.type === "charge" && t.created > 1_700_000_000);
    expect(betrag(zahlung!.id)).toBe(11900);
    expect(betrag(`${zahlung!.id}-gebuehr`)).toBe(-400);
    const streit = transactions.find((t) => t.type === "adjustment")!;
    expect(betrag(streit.id)).toBe(-4800);
    expect(betrag(`${streit.id}-gebuehr`)).toBe(-1500);
    // Alle Umsätze zusammen sind das Netto aller Balance Transactions
    expect(umsaetze.reduce((s, u) => s + Number(u.amount), 0)).toBe(transactions.reduce((s, t) => s + t.net, 0));
  });

  it("speichert über den Importvertrag: Quelle des Kontos, Hauptbetrag und Gebühr als zwei Bewegungen", async () => {
    const quellen = await sql`select provider, external_account_id, account_kind from import_sources`;
    expect(quellen.map((q) => [q.provider, q.external_account_id, q.account_kind])).toEqual([["stripe", "acct_beispiel", "psp"]]);
    const [zahlung] = transactions.filter((t) => t.type === "charge" && t.created > 1_700_000_000);
    const bewegungen = await sql`select component, amount from import_movements where source_event_id = ${zahlung!.id} order by component`;
    expect(bewegungen.map((b) => [b.component, Number(b.amount)])).toEqual([
      ["fee", -400],
      ["main", 11900],
    ]);
    const [alle] = await sql`select count(*)::int as n from import_movements`;
    expect(alle!.n).toBe(10);
  });

  it("legt beim zweiten Abruf nichts doppelt an und zieht den Startpunkt nach", async () => {
    const result = await stripe.syncStripe(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(10);
    // Drei Tage vor heute
    const [row] = await sql`select fetch_from::text as f, last_error from stripe_connections`;
    expect(row!.f).toBe("2026-11-04");
    expect(row!.last_error).toBeNull();
    expect((await stripe.stripeSummary()).fetchFrom).toBe("2019-01-01");
  });

  it("erzeugt mit einem späteren CSV-Import desselben Zeitraums keine Dubletten", async () => {
    const konto = (await sql`select id from bank_accounts where provider = 'stripe'`)[0]!.id as string;
    const result = await bank.importStatement(actor, { bytes: csv(), filename: "balance-history.csv" }, konto);
    expect(result.added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(10);
  });

  it("nimmt einen Abruf mit anderem Betrag zu einer schon übernommenen Bewegung nicht an und zeigt den Konflikt", async () => {
    const [zahlung] = transactions.filter((t) => t.type === "charge" && t.created > 1_700_000_000);
    imAbruf = transactions.map((t) => (t.id === zahlung!.id ? { ...t, amount: 12000, net: 11600 } : t));
    try {
      const result = await stripe.syncStripe(actor, new Date("2026-11-08T10:00:00Z"));
      expect(result.error).toContain("Konflikt");
      expect(result.added).toBe(0);
      const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
      expect(anzahl!.n).toBe(10);
      const stand = await stripe.stripeSummary();
      expect(stand.konflikte).toHaveLength(1);
      expect(stand.lastError).toContain("Konflikt");
    } finally {
      imAbruf = transactions;
    }
  });

  it("meldet einen abgelehnten Schlüssel am Zugang, ohne ihn zu nennen", async () => {
    stripe.setStripeClientFactory(
      () =>
        ({
          accountId: async () => {
            throw new Error("Zugriff abgelehnt: Invalid API Key");
          },
        }) as unknown as StripeClient,
    );
    try {
      await expect(stripe.saveStripeConnection(actor, { apiKey: "rk_live_zzzzzzzzzzzzzzzz", fetchFrom: "2019-01-01" })).rejects.toThrow("Zugriff abgelehnt");
    } finally {
      stripe.setStripeClientFactory(() => fake());
    }
    expect((await stripe.stripeSummary()).keyHint).toBe("mnop");
  });

  it("beginnt bei einem Schlüssel eines anderen Kontos wieder am gewählten Tag", async () => {
    stripe.setStripeClientFactory(() => fake("acct_anderes"));
    try {
      await stripe.saveStripeConnection(actor, { apiKey: "rk_test_qrstuvwxyz1234", fetchFrom: "2019-01-01" });
    } finally {
      stripe.setStripeClientFactory(() => fake());
    }
    const stand = await stripe.stripeSummary();
    expect(stand).toMatchObject({ accountId: "acct_anderes", testmodus: true, naechsterAbrufAb: "2019-01-01" });
  });

  it("entfernt den Zugang, übernommene Umsätze bleiben stehen", async () => {
    await stripe.deleteStripeConnection(actor);
    expect((await stripe.stripeSummary()).configured).toBe(false);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(10);
  });
});
