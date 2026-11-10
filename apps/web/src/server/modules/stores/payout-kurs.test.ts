import { gzipSync, strToU8 } from "fflate";
import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppStoreClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Auszahlung von Apple für einen Fiskalmonat, in dem eine Währung noch ohne Umsatzsteuer-Umrechnungskurs ist (etwa TWD,
 * für das das BMF keinen Kurs veröffentlicht): Deren Erlösanteil steht nicht im Konto des Stores. Die Auszahlung darf
 * ihn nicht als Kursdifferenz buchen, sonst fehlt er in Rechnung, Kz 21 und Zusammenfassender Meldung.
 */

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const IBAN = "DE12500105170648489890";

const report = gzipSync(
  strToU8(
    [
      "Vendor Name\tStart Date\tEnd Date\tExtended Partner Share\tPartner Share Currency\tSale or Return",
      "Muster\t09/28/2026\t11/01/2026\t7.00\tEUR\tS",
      "Muster\t09/28/2026\t11/01/2026\t10.81\tUSD\tS",
      "Muster\t09/28/2026\t11/01/2026\t35.00\tTWD\tS",
    ].join("\n"),
  ),
);
const appleClient: AppStoreClient = { financeDetail: async (month) => (month === "2026-10" ? report : null) };

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
});
