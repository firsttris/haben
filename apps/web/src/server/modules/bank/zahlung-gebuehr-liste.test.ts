import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Zähler „Offen“ bei Zahlung und Gebühr eines Zahlungsdienstleisters (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  it("zählt Zahlung und Gebühr einer Bewegung einmal, wie die Liste sie in einer Zeile zeigt", async () => {
    const stripe = await bank.createProviderAccount(actor, { name: "Stripe", provider: "stripe" });
    const csv = [
      "balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,description",
      "txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung",
      "txn_2,2026-10-02 10:00:00,2026-10-09 00:00:00,eur,10.00,0.50,9.50,charge,Spende",
      "txn_3,2026-10-08 06:00:00,2026-10-08 00:00:00,eur,-67.50,0.00,-67.50,payout,STRIPE PAYOUT",
    ].join("\n");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "stripe.csv" }, stripe.id);
    const zaehler = async () => (await bank.listAccounts()).find((a) => a.id === stripe.id)?.openCount;

    // Fünf Umsätze, drei Zeilen: zwei Zahlungen mit ihrer Gebühr und die Auszahlung
    expect(await zaehler()).toBe(3);
  }, 30_000);
});
