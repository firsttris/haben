import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Der CSV-Export „Balance history“ kam vor dem Abruf (#1280, #306): Der Abruf verbindet die Umsätze aus der Datei mit
 * der Kennung der Balance Transaction, statt sie ein zweites Mal anzulegen. Eigene Testdatei, weil sie eine leere
 * Datenbank braucht; Aufbau und Daten wie stripe.test.ts.
 */

const transactions: StripeBalanceTransaction[] = JSON.parse(
  readFileSync(new URL("../../../../../../packages/import/test-fixtures/stripe/sandbox-balance-transactions.json", import.meta.url), "utf8"),
);
const HEUTE = new Date("2026-11-07T10:00:00Z");

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

describe.skipIf(!testDatabaseUrl)("Stripe-Abruf nach dem CSV-Export (Postgres)", () => {
  let stripe: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    stripe = await import("./index.ts");
    bank = await import("../bank/index.ts");
    stripe.setStripeClientFactory(() => ({ accountId: async () => "acct_beispiel", balanceTransactions: async () => transactions }) as unknown as StripeClient);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("verbindet einen früheren CSV-Import mit der Kennung, statt die Umsätze neu anzulegen", async () => {
    await stripe.saveStripeConnection(actor, { apiKey: "rk_live_abcdefghijklmnop", fetchFrom: "2019-01-01" });
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe', 'zahlungsdienstleister', 'stripe', 3)`;
    const konto = (await sql`select id from bank_accounts where provider = 'stripe'`)[0]!.id as string;
    const csvImport = await bank.importStatement(actor, { bytes: csv(), filename: "balance-history.csv" }, konto);
    expect(csvImport.added).toBe(10);
    const result = await stripe.syncStripe(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(10);
    // Die Kennungen sind nun mit den Umsätzen aus der Datei verbunden: ein weiterer Abruf erkennt sie daran
    const [bewegungen] = await sql`select count(*)::int as n from import_movements`;
    expect(bewegungen!.n).toBe(10);
  });
});
