import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppStoreClient } from "@haben/import";
import { APPLE_TEST_PERIOD, appleFinanceReport } from "../../../test-fixtures/apple-finanzbericht.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Auszahlung von Apple für einen Fiskalmonat, in dem eine Währung noch ohne Umsatzsteuer-Umrechnungskurs ist (etwa TWD,
 * für das das BMF keinen Kurs veröffentlicht): Deren Erlösanteil steht nicht im Konto des Stores. Die Auszahlung darf
 * ihn nicht als Kursdifferenz buchen, sonst fehlt er in Rechnung, Kz 21 und Zusammenfassender Meldung.
 */

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const IBAN = "DE12500105170648489890";

const report = appleFinanceReport([
  ["7.00", "EUR"],
  ["10.81", "USD"],
  ["35.00", "TWD"],
]);
const appleClient: AppStoreClient = { financeDetail: async (period) => (period === APPLE_TEST_PERIOD ? report : null) };

describe.skipIf(!testDatabaseUrl)("Auszahlung von Apple mit einer Währung ohne Kurs (Postgres)", () => {
  let stores: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const NOW = new Date("2026-12-10T10:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    stores = await import("./index.ts");
    bank = await import("../bank/index.ts");
    db = await import("../../db/index.ts");
    stores.setStoreClientFactories({ appstore: () => appleClient });
    await bank.createProviderAccount(actor, { name: "App Store", provider: "appstore" });
    await sql`insert into exchange_rates (currency, month, rate, source) values ('USD', '2026-10', 1.0810, 'manuell')`;
    await stores.saveStoreConnection(actor, {
      store: "appstore",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      vendorNumber: "85012345",
      privateKey: p8,
      fetchFrom: "2026-10",
    });
    await stores.syncStore(actor, "appstore", NOW);
    const account = (await bank.createAccount(actor, { name: "Geschäftskonto", iban: IBAN, purpose: "geschaeft" })).id;
    // Apple zahlt alle drei Währungen gesammelt in Euro: 7,00 € + 10,00 € + rund 1,00 € für 35 TWD
    await db.db.transaction((tx) =>
      bank.storeStatement(
        tx,
        {
          format: "dkb-csv",
          currency: "EUR",
          accountIban: IBAN,
          warnings: [],
          transactions: [
            {
              bookingDate: "2026-12-05",
              amount: 1800,
              currency: "EUR",
              counterpartyName: "Apple Distribution International Ltd",
              purpose: "Apple Zahlung",
              bankReference: "bank-apple",
              index: 0,
            },
          ],
        },
        { filename: "kontoauszug", sha256: "y" },
        account,
      ),
    );
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("bucht den fehlenden Erlösanteil nicht als Kursdifferenz", async () => {
    const [deposit] = await sql`select id from bank_transactions where bank_reference = 'bank-apple'`;
    const view = await stores.storePayoutView(deposit!.id);
    expect(view!.months.map((m) => m.amount)).toEqual([700, 1000]);
    await expect(stores.takeOverStorePayout(actor, { transactionId: deposit!.id, monthIds: view!.months.map((m) => m.id) })).rejects.toThrow(/TWD/);
    const [count] = await sql`select count(*)::int as n from store_payouts`;
    expect(count!.n).toBe(0);
  });

  it("schlägt einen Fiskalmonat mit Erlösanteil unter Dublettenverdacht nicht teilweise vor (#865)", async () => {
    const [deposit] = await sql`select id from bank_transactions where bank_reference = 'bank-apple'`;
    const [usd] = await sql`
      select id, bank_account_id, booking_date, amount from bank_transactions where bank_reference = 'appstore-finance-2026-10-USD'
    `;
    const [source] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${usd!.bank_account_id}, 'frueherer-import.csv', 'frueherer-import', 'dkb-csv', 1, 0) returning id
    `;
    const [original] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
      values (${usd!.bank_account_id}, ${source!.id}, ${usd!.booking_date}, ${usd!.amount}, 'Früherer Umsatz', 'frueherer-umsatz') returning id
    `;
    const [review] = await sql`
      insert into bank_duplicate_reviews (transaction_id, original_transaction_id) values (${usd!.id}, ${original!.id}) returning id
    `;
    const view = await stores.storePayoutView(deposit!.id);
    expect(view!.months).toMatchObject([{ amount: 700, suggested: false }]);
    await expect(stores.takeOverStorePayout(actor, { transactionId: deposit!.id, monthIds: [usd!.id] })).rejects.toThrow(/Dublettenvermerk/);
    await expect(stores.takeOverStorePayout(actor, { transactionId: deposit!.id, monthIds: view!.months.map((m) => m.id) })).rejects.toThrow(
      /Dublettenvermerk.*USD/,
    );

    const { decideDuplicate } = await import("../bank/duplicate-review.ts");
    await decideDuplicate(actor, { id: review!.id, decision: "duplicate", requestId: crypto.randomUUID() });
    expect((await stores.storePayoutView(deposit!.id))!.months).toMatchObject([{ amount: 700, suggested: false }]);
    const [decision] = await sql`select id from bank_duplicate_decisions where review_id = ${review!.id}`;
    await decideDuplicate(actor, { id: review!.id, decision: "pending", decisionId: decision!.id });
    await decideDuplicate(actor, { id: review!.id, decision: "distinct", requestId: crypto.randomUUID() });
  });

  it("nimmt die Auszahlung an, sobald der Kurs eingetragen und die Währung übernommen ist", async () => {
    await sql`insert into exchange_rates (currency, month, rate, source) values ('TWD', '2026-10', 35.0, 'manuell')`;
    expect((await stores.syncStore(actor, "appstore", NOW)).imported.added).toBe(1);
    const [deposit] = await sql`select id from bank_transactions where bank_reference = 'bank-apple'`;
    const view = await stores.storePayoutView(deposit!.id);
    expect(view!.months.map((m) => m.amount)).toEqual([700, 100, 1000]);
    expect(await stores.takeOverStorePayout(actor, { transactionId: deposit!.id, monthIds: view!.months.map((m) => m.id) })).toEqual({ difference: 0 });
  });

  it("lässt einen bereits ausgezahlten Erlösanteil im Konto des Stores", async () => {
    const [review] = await sql<{ id: string; decision_id: string }[]>`
      select r.id, haben_active_bank_duplicate_decision(r.id) as decision_id
      from bank_duplicate_reviews r join bank_transactions t on t.id = r.transaction_id
      where t.bank_reference = 'appstore-finance-2026-10-USD'
    `;
    const { decideDuplicate } = await import("../bank/duplicate-review.ts");
    const { userMessage } = await import("../../errors.ts");
    await decideDuplicate(actor, { id: review!.id, decision: "pending", decisionId: review!.decision_id });
    const result = await decideDuplicate(actor, { id: review!.id, decision: "duplicate", requestId: crypto.randomUUID() }).catch(userMessage);
    expect(result).toBe("Der Umsatz gehört zu einer bereits übernommenen Store-Auszahlung");
  });
});
