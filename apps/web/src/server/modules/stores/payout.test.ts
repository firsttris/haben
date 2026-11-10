import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedStatement } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Auszahlung eines App-Stores: Bankeingang → Auszahlung im Konto des Stores, Geldtransit, bei Apple Kursdifferenz */

const IBAN = "DE12500105170648489890";

/** Konten je Kontenrahmen: Bank, Geldtransit, Verrechnungskonto Google (erstes) und Apple (zweites), Kursertrag und -aufwand */
const CASES = [
  { kontenrahmen: "SKR03", versteuerung: "ist", bank: "1200", transit: "1360", google: "1361", apple: "1362", ertrag: "2660", aufwand: "2150" },
  { kontenrahmen: "SKR04", versteuerung: "soll", bank: "1800", transit: "1460", google: "1461", apple: "1462", ertrag: "4840", aufwand: "6880" },
] as const;

describe.skipIf(!testDatabaseUrl).each(CASES)("Auszahlung der App-Stores ($kontenrahmen, $versteuerung, Postgres)", (c) => {
  let stores: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const ids = { google: "", apple: "" };

  /** Umsätze direkt in ein Konto, wie sie der Import anlegt */
  async function put(accountId: string, statement: Omit<ParsedStatement, "currency" | "warnings">) {
    await db.db.transaction((tx) => bank.storeStatement(tx, { currency: "EUR", warnings: [], ...statement }, { filename: "test", sha256: "x" }, accountId));
  }

  const tx = (bookingDate: string, amount: number, counterpartyName: string, bankReference: string, index = 0) => ({
    bookingDate,
    amount,
    currency: "EUR",
    counterpartyName,
    purpose: bankReference,
    bankReference,
    index,
  });

  async function idOf(reference: string) {
    const [row] = await sql`select id from bank_transactions where bank_reference = ${reference}`;
    return row!.id as string;
  }

  const ledger = (allocationTx: string) =>
    sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        join allocations a on a.id = e.source_id where a.transaction_id = ${allocationTx} order by l.account`;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${c.versteuerung}, ${c.kontenrahmen})`;
    stores = await import("./index.ts");
    bank = await import("../bank/index.ts");
    db = await import("../../db/index.ts");
    ids.google = (await bank.createProviderAccount(actor, { name: "Google Play", provider: "googleplay" })).id;
    ids.apple = (await bank.createProviderAccount(actor, { name: "App Store", provider: "appstore" })).id;
    await put(ids.google, {
      format: "googleplay-earnings",
      transactions: [
        tx("2026-08-31", 850, "Google Play", "googleplay-earnings-2026-08"),
        tx("2026-09-30", 1200, "Google Play", "googleplay-earnings-2026-09", 1),
      ],
    });
    await put(ids.apple, {
      format: "appstore-finance",
      transactions: [
        tx("2026-10-04", 700, "App Store", "appstore-finance-2026-09-EUR"),
        tx("2026-10-04", 1000, "App Store", "appstore-finance-2026-09-USD", 1),
        tx("2026-11-01", 500, "App Store", "appstore-finance-2026-10-EUR", 2),
      ],
    });
    // Eingänge auf dem Geschäftskonto
    await put((await bank.createAccount(actor, { name: "Geschäftskonto", iban: IBAN, purpose: "geschaeft" })).id, {
      format: "dkb-csv",
      accountIban: IBAN,
      transactions: [
        tx("2026-09-28", 850, "Google Payment Ireland Ltd", "bank-google-1"),
        tx("2026-10-28", 1300, "Google Payment Ireland Ltd", "bank-google-2", 1),
        tx("2026-11-05", 1725, "Apple Distribution International Ltd", "bank-apple-1", 2),
        tx("2026-12-05", 470, "Apple Distribution International Ltd", "bank-apple-2", 3),
        tx("2026-12-06", 99, "Muster GmbH", "bank-kunde", 4),
        tx("2026-12-07", 300, "Apple Distribution International Ltd", "bank-apple-3", 5),
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("erkennt den Eingang eines Stores und schlägt die passenden Monate vor", async () => {
    const view = await stores.storePayoutView(await idOf("bank-google-1"));
    expect(view).toMatchObject({ store: "googleplay", accountName: "Google Play" });
    expect(view!.months.map((m) => [m.amount, m.suggested])).toEqual([
      [850, true],
      [1200, false],
    ]);
    // Apple: der ganze Fiskalmonat (beide Währungen) liegt näher an 17,25 € als mit Oktober
    const apple = await stores.storePayoutView(await idOf("bank-apple-1"));
    expect(apple!.months.map((m) => [m.amount, m.suggested])).toEqual([
      [700, true],
      [1000, true],
      [500, false],
    ]);
    expect(await stores.storePayoutView(await idOf("bank-kunde"))).toBeNull();
    expect(await stores.storePayoutView(await idOf("googleplay-earnings-2026-08"))).toBeNull();
  });

  it("Google: legt die Auszahlung an und bucht beide Seiten als Geldtransit", async () => {
    const deposit = await idOf("bank-google-1");
    const view = await stores.storePayoutView(deposit);
    const result = await stores.takeOverStorePayout(actor, { transactionId: deposit, monthIds: [view!.months[0]!.id] });
    expect(result).toEqual({ difference: 0 });

    const rows =
      await sql`select amount, purpose, bank_reference from bank_transactions where bank_account_id = ${ids.google} and bank_reference like 'googleplay-payout-%'`;
    expect(rows).toEqual([
      { amount: -850, purpose: "Auszahlung Google Play auf Geschäftskonto für googleplay-earnings-2026-08", bank_reference: `googleplay-payout-${deposit}` },
    ]);
    // Bank an Geldtransit; im Store-Konto Geldtransit an dessen Verrechnungskonto
    expect(await ledger(deposit)).toEqual(
      [
        { account: c.bank, debit: 850, credit: 0 },
        { account: c.transit, debit: 0, credit: 850 },
      ].sort((a, b) => a.account.localeCompare(b.account)),
    );
    expect(await ledger(await idOf(`googleplay-payout-${deposit}`))).toEqual([
      { account: c.transit, debit: 850, credit: 0 },
      { account: c.google, debit: 0, credit: 850 },
    ]);
    // Der Monat ist bezahlt und wird nicht mehr angeboten; der Eingang ist zugeordnet
    expect((await stores.storePayoutView(await idOf("bank-google-2")))!.months.map((m) => m.amount)).toEqual([1200]);
    expect(await stores.storePayoutView(deposit)).toBeNull();
  });

  it("Google: Ein Eingang, der nicht genau den gewählten Monaten entspricht, bucht nichts", async () => {
    const deposit = await idOf("bank-google-2");
    const view = await stores.storePayoutView(deposit);
    await expect(stores.takeOverStorePayout(actor, { transactionId: deposit, monthIds: [view!.months[0]!.id] })).rejects.toThrow(/Google zahlt in Euro genau/);
    const [count] = await sql`select count(*)::int as n from bank_transactions where bank_reference like 'googleplay-payout-%'`;
    expect(count!.n).toBe(1);
  });

  it("Apple: bucht die Abweichung zum Umrechnungskurs als Kursertrag", async () => {
    const deposit = await idOf("bank-apple-1");
    const view = await stores.storePayoutView(deposit);
    const chosen = view!.months.filter((m) => m.suggested).map((m) => m.id);
    expect(await stores.takeOverStorePayout(actor, { transactionId: deposit, monthIds: chosen })).toEqual({ difference: 25 });

    const difference = await idOf(`appstore-kursdifferenz-${deposit}`);
    // Store-Konto an Kursertrag 0,25 €
    expect(await ledger(difference)).toEqual([
      { account: c.apple, debit: 25, credit: 0 },
      { account: c.ertrag, debit: 0, credit: 25 },
    ]);
    // Monate + Auszahlung + Differenz: das Konto steht für den Fiskalmonat auf null
    const [balance] = await sql`select sum(amount)::int as s from bank_transactions where bank_account_id = ${ids.apple} and booking_date <= '2026-11-05'`;
    expect(balance!.s).toBe(500);
    const [payout] = await sql`select covered from store_payouts where bank_transaction_id = ${deposit}`;
    expect(payout!.covered).toEqual(["appstore-finance-2026-09-EUR", "appstore-finance-2026-09-USD"]);
  });

  it("Apple: Kursverlust als Aufwand, zu große Abweichung abgelehnt, ein bezahlter Monat nicht zweimal", async () => {
    const deposit = await idOf("bank-apple-2");
    const view = await stores.storePayoutView(deposit);
    expect(view!.months.map((m) => m.amount)).toEqual([500]);
    // 3,00 € gegen 5,00 €: kein Kursunterschied, sondern die falsche Auswahl
    await expect(stores.takeOverStorePayout(actor, { transactionId: await idOf("bank-apple-3"), monthIds: [view!.months[0]!.id] })).rejects.toThrow(
      /so große Kursdifferenz/,
    );
    const paid = await idOf("appstore-finance-2026-09-EUR");
    await expect(stores.takeOverStorePayout(actor, { transactionId: deposit, monthIds: [paid] })).rejects.toThrow(/schon ausgezahlt/);

    await expect(stores.takeOverStorePayout(actor, { transactionId: await idOf("bank-google-2"), monthIds: [view!.months[0]!.id] })).rejects.toThrow(
      /schon ausgezahlt oder gehört nicht/,
    );

    expect(await stores.takeOverStorePayout(actor, { transactionId: deposit, monthIds: [view!.months[0]!.id] })).toEqual({ difference: -30 });
    expect(await ledger(await idOf(`appstore-kursdifferenz-${deposit}`))).toEqual(
      [
        { account: c.apple, debit: 0, credit: 30 },
        { account: c.aufwand, debit: 30, credit: 0 },
      ].sort((a, b) => a.account.localeCompare(b.account)),
    );
  });

  it("hält die Auszahlungen unveränderlich", async () => {
    await expect(sql`delete from store_payouts`).rejects.toThrow();
    const [count] = await sql`select count(*)::int as n from store_payouts`;
    expect(count!.n).toBe(3);
  });
});
