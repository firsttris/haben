import { gzipSync, strToU8, zipSync } from "fflate";
import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppStoreClient, GooglePlayClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Übernahme archivierter Store-Berichte ins Zahlungsdienstleister-Konto; Berichte nachgebaut nach den Beschreibungen der Stores */

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const serviceAccountJson = JSON.stringify({ type: "service_account", client_email: "haben@projekt.iam.gserviceaccount.com", private_key: rsa });

const googleCsv = (rows: [string, string, string][]) =>
  [
    "Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Merchant Currency,Amount (Merchant Currency)",
    ...rows.map(([date, type, amount]) => `GPA.1,"${date}",12:00:00 PM PDT,,${type},,App,EUR,${amount}`),
  ].join("\n");

const appleTsv = (rows: [string, string][]) =>
  gzipSync(
    strToU8(
      [
        "Vendor Name\tStart Date\tEnd Date\tExtended Partner Share\tPartner Share Currency\tSale or Return",
        ...rows.map(([amount, currency]) => `Muster\t09/28/2026\t11/01/2026\t${amount}\t${currency}\tS`),
      ].join("\n"),
    ),
  );

const google = new Map<string, Uint8Array>([
  [
    "earnings/earnings_202609.zip",
    zipSync({
      "earnings_202609.csv": strToU8(
        googleCsv([
          ["Sep 3, 2026", "Charge", "10.00"],
          ["Sep 3, 2026", "Google fee", "-1.50"],
        ]),
      ),
    }),
  ],
  // Kaputte Datei: kommt ins Archiv, aber nicht ins Konto
  ["earnings/earnings_202610.zip", new Uint8Array([0x50, 0x4b, 3, 4, 0])],
]);
const apple = new Map<string, Uint8Array>([
  [
    "2026-10",
    appleTsv([
      ["7.00", "EUR"],
      ["10.81", "USD"],
    ]),
  ],
]);

const googleClient: GooglePlayClient = {
  listEarnings: async () => [...google.keys()].map((name) => ({ name, month: `${name.slice(18, 22)}-${name.slice(22, 24)}`, size: 1 })),
  download: async (name) => google.get(name)!,
};
const appleClient: AppStoreClient = { financeDetail: async (month) => apple.get(month) ?? null };

describe.skipIf(!testDatabaseUrl)("Übernahme der Store-Berichte ins Konto (Postgres)", () => {
  let stores: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const NOW = new Date("2026-11-10T10:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    stores = await import("./index.ts");
    bank = await import("../bank/index.ts");
    stores.setStoreClientFactories({ googleplay: () => googleClient, appstore: () => appleClient });
    await stores.saveStoreConnection(actor, { store: "googleplay", bucket: "pubsite_prod_rev_1", serviceAccountJson, fetchFrom: "2026-09" });
    await stores.saveStoreConnection(actor, {
      store: "appstore",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      vendorNumber: "85012345",
      privateKey: p8,
      fetchFrom: "2026-10",
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const rows = (provider: string) =>
    sql`select t.booking_date::text as date, t.amount, t.bank_reference as ref, t.purpose from bank_transactions t
        join bank_accounts a on a.id = t.bank_account_id where a.provider = ${provider} order by t.bank_reference`;

  it("archiviert ohne Konto und sagt, was fehlt", async () => {
    const result = await stores.syncStore(actor, "googleplay", NOW);
    expect(result.added).toHaveLength(2);
    expect(result.imported).toEqual({
      accountName: null,
      added: 0,
      drafts: 0,
      messages: [expect.stringContaining("Für Google Play gibt es noch kein Konto")],
    });
  });

  it("übernimmt nach dem Anlegen des Kontos den Monat netto, die kaputte Datei mit Hinweis", async () => {
    await bank.createProviderAccount(actor, { name: "Google Play", provider: "googleplay" });
    const result = await stores.syncStore(actor, "googleplay", NOW);
    expect(result.added).toEqual([]);
    expect(result.imported.added).toBe(1);
    // Ohne gewählte Store-Gesellschaft kein Rechnungsentwurf, mit Hinweis (drafts.test.ts)
    expect(result.imported.messages).toEqual([expect.stringMatching(/^earnings_202610\.zip: /), expect.stringContaining("Rechnungsentwürfe an Google Play")]);
    expect(await rows("googleplay")).toEqual([
      {
        date: "2026-09-30",
        amount: 850,
        ref: "googleplay-earnings-2026-09",
        purpose: "Google Play Einnahmen 09/2026: Umsätze 10,00 €, Gebühren -1,50 €; 2 Vorgänge vom 2026-09-03 bis 2026-09-03",
      },
    ]);
    const [imported] = await sql`select format, filename from bank_imports where format = 'googleplay-earnings'`;
    expect(imported).toMatchObject({ filename: "earnings_202609.zip" });
  });

  it("holt eine Fremdwährung nach, sobald ihr Kurs vorliegt, ohne den Euro-Teil zu verdoppeln", async () => {
    await bank.createProviderAccount(actor, { name: "App Store", provider: "appstore" });
    const first = await stores.syncStore(actor, "appstore", NOW);
    expect(first.imported.added).toBe(1);
    expect(first.imported.messages).toEqual([
      expect.stringContaining("Für USD fehlt der Umsatzsteuer-Umrechnungskurs 10/2026"),
      expect.stringContaining("Rechnungsentwürfe an App Store"),
    ]);

    await sql`insert into exchange_rates (currency, month, rate, source) values ('USD', '2026-10', 1.0810, 'manuell')`;
    const second = await stores.syncStore(actor, "appstore", NOW);
    expect(second.imported).toMatchObject({ accountName: "App Store", added: 1, messages: [expect.stringContaining("Rechnungsentwürfe an App Store")] });
    expect((await rows("appstore")).map((r) => [r.date, r.amount, r.ref])).toEqual([
      ["2026-11-01", 700, "appstore-finance-2026-10-EUR"],
      ["2026-11-01", 1000, "appstore-finance-2026-10-USD"],
    ]);

    // Ein geänderter Kurs legt nichts doppelt an
    await sql`update exchange_rates set rate = 1.2 where currency = 'USD' and month = '2026-10'`;
    const third = await stores.syncStore(actor, "appstore", NOW);
    expect(third.imported.added).toBe(0);
    expect(await rows("appstore")).toHaveLength(2);
  });

  it("ein zweiter Abruf ändert im Konto nichts", async () => {
    const again = await stores.syncStore(actor, "googleplay", NOW);
    expect(again.imported.added).toBe(0);
    expect(await rows("googleplay")).toHaveLength(1);
    const [count] = await sql`select count(*)::int as n from bank_imports where format = 'googleplay-earnings'`;
    expect(count!.n).toBe(1);
  });
});
