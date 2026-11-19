import { readFileSync } from "node:fs";
import {
  type EbTransaction,
  enableBankingBatch,
  enableBankingStatement,
  entryReferenceOf,
  type ParsedStatement,
  parseStatement,
  type StatementFormat,
} from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ein Konto bekommt seine Umsätze aus einer Quelle (#632). Der Dubletten-Hash enthält das
 * Buchungsdatum, und die Quellen schreiben es unterschiedlich: Accountable das Zahlungsdatum,
 * Swan das Buchungsdatum. Beim Wechsel der Quelle legt Haben dieselbe Zahlung deshalb ein
 * zweites Mal an — das muss es melden.
 */
const IBAN = "DE12500105170648489890";

describe.skipIf(!testDatabaseUrl)("Warnung bei zweiter Quelle im selben Zeitraum (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    db = await import("../../db/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const umsatz = (bookingDate: string, amount: number, purpose: string) => ({
    bookingDate,
    amount,
    currency: "EUR",
    counterpartyName: "Muster GmbH",
    purpose,
    index: 0,
  });

  type Zeile = ReturnType<typeof umsatz>;

  async function importiere(format: string, filename: string, transactions: Zeile[], zeitraum?: { von: string; bis: string }) {
    const statement: ParsedStatement = {
      format: format as StatementFormat,
      accountIban: IBAN,
      accountName: "Testkonto",
      currency: "EUR",
      periodFrom: zeitraum?.von,
      periodTo: zeitraum?.bis,
      transactions,
      warnings: [],
    };
    // Der Auszug kommt als Datei mit dieser IBAN, deshalb findet storeStatement das Konto selbst.
    return db.db.transaction((tx) => bank.storeStatement(tx, statement, { filename, sha256: filename }, null));
  }

  it("meldet vorhandene Accountable-Umsätze, wenn Swan im selben Zeitraum neu anlegt", async () => {
    // Dieselbe Zahlung, drei Tage auseinander: Accountable nennt den 09.01., Swan den 12.01.
    await importiere("accountable-xlsx", "Accountable-2026.zip", [umsatz("2026-01-09", -1749, "Seller")]);
    const r = await importiere("swan-csv", "Swan_2026-01-01_bis_2026-03-31.csv", [umsatz("2026-01-12", -1749, "Seller")], {
      von: "2026-01-01",
      bis: "2026-03-31",
    });
    expect(r.added).toBe(1);
    expect(r.quelle).toContain("Accountable");
    expect(r.quelle).toContain("Accountable-2026.zip");
    expect(r.quelle).toContain("2026-01-01 bis 2026-03-31");
    expect(r.quelle).toContain("hat 1 Umsätze neu angelegt");
  });

  it("meldet vorhandene Swan-Umsätze, wenn CAMT.053 im selben Zeitraum neu anlegt", async () => {
    const r = await importiere("camt053", "auszug.xml", [umsatz("2026-01-13", -5000, "Telefon")], {
      von: "2026-01-01",
      bis: "2026-01-31",
    });
    expect(r.added).toBe(1);
    expect(r.quelle).toContain("Swan");
    expect(r.quelle).toContain("CAMT.053");
  });

  it("schweigt beim gleichen Format", async () => {
    const r = await importiere("swan-csv", "Swan_2026-04-01_bis_2026-06-30.csv", [umsatz("2026-04-05", -990, "April")], {
      von: "2026-04-01",
      bis: "2026-06-30",
    });
    expect(r.added).toBe(1);
    expect(r.quelle).toBeNull();
  });

  it("schweigt, wenn nur übersprungen wird", async () => {
    const r = await importiere("swan-csv", "Swan_2026-04-01_bis_2026-06-30_nochmal.csv", [umsatz("2026-04-05", -990, "April")], {
      von: "2026-04-01",
      bis: "2026-06-30",
    });
    expect(r.added).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.quelle).toBeNull();
  });

  it("schweigt ohne Überlapp des Zeitraums", async () => {
    const r = await importiere("camt053", "auszug-august.xml", [umsatz("2026-08-05", -777, "August")], {
      von: "2026-08-01",
      bis: "2026-08-31",
    });
    expect(r.added).toBe(1);
    expect(r.quelle).toBeNull();
  });

  it("nennt den Bankabruf lesbar und nicht mit seinem technischen Formatnamen", async () => {
    // Der häufigste Wechsel der Quelle: erst der Abruf über Enable Banking, dann eine Datei für dieselben Tage
    await importiere("enablebanking", "Abruf Swan 2026-09-30", [umsatz("2026-09-10", -2500, "Hosting")]);
    const r = await importiere("camt053", "auszug-september.xml", [umsatz("2026-09-11", -2500, "Hosting")], {
      von: "2026-09-01",
      bis: "2026-09-30",
    });
    expect(r.quelle).toContain("Abruf Swan 2026-09-30");
    expect(r.quelle).not.toContain("enablebanking");
  });

  it("nennt den Stichtag, wenn das Konto schon per Abruf mit Quellenbindung läuft (#306)", async () => {
    const iban = "DE02120300000000202051";
    const transactions: EbTransaction[] = [
      {
        entry_reference: "ER-1",
        transaction_amount: { currency: "EUR", amount: "25.00" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2026-10-10",
        creditor: { name: "Hosting" },
        remittance_information: ["Hosting"],
      },
    ];
    const fenster = { transactions, balances: [], dateFrom: "2026-10-01", dateTo: "2026-10-31" };
    const { storeBatch } = await import("./import-batch.ts");
    await db.db.transaction((tx) =>
      storeBatch(
        tx,
        {
          batch: enableBankingBatch({ externalAccountId: "hash-q", ...fenster, fetchedAt: "2026-10-31T12:00:00+01:00", fetchId: "q1" }),
          binding: { provider: "enablebanking", externalAccountId: "hash-q", accountKind: "bank" },
          statement: enableBankingStatement({ account: { uid: "u", account_id: { iban }, name: "Abrufkonto" }, ...fenster }),
          eventOf: entryReferenceOf(transactions),
          source: { filename: "Abruf Testbank 2026-10-31", sha256: "q1".padEnd(64, "0") },
        },
        null,
      ),
    );
    const statement: ParsedStatement = {
      format: "camt053",
      accountIban: iban,
      currency: "EUR",
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      transactions: [umsatz("2026-10-11", -2500, "Hosting Oktober")],
      warnings: [],
    };
    const r = await db.db.transaction((tx) => bank.storeStatement(tx, statement, { filename: "oktober.xml", sha256: "oktober.xml" }, null));
    expect(r.quelle).toContain("Abruf Testbank 2026-10-31");
    expect(r.quelle).toContain("Seit dem Stichtag 2026-10-01 holt der Bankabruf die Umsätze dieses Kontos");
    expect(r.quelle).not.toContain("Wer die Quelle wechselt");
    // Hinter dem Konto unter „Automatischer Abruf“: Bankabruf seit dem Stichtag, davor keine Dateien
    const { cutoverDates } = await import("./andere-importe.ts");
    expect((await cutoverDates()).find((c) => c.cutoverDate === "2026-10-01")).toMatchObject({ filesBefore: false });
  });

  it("nennt „davor Dateien oder FinTS“, wenn vor dem Stichtag eine Datei steht", async () => {
    const iban = "DE89370400440532013000";
    const datei: ParsedStatement = {
      format: "camt053",
      accountIban: iban,
      currency: "EUR",
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      transactions: [umsatz("2026-08-20", -1000, "Miete August")],
      warnings: [],
    };
    await db.db.transaction((tx) => bank.storeStatement(tx, datei, { filename: "august.xml", sha256: "august.xml" }, null));
    const transactions: EbTransaction[] = [
      {
        entry_reference: "ER-9",
        transaction_amount: { currency: "EUR", amount: "10.00" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2026-09-10",
        creditor: { name: "Miete" },
        remittance_information: ["Miete September"],
      },
    ];
    const fenster = { transactions, balances: [], dateFrom: "2026-09-01", dateTo: "2026-09-30" };
    const { storeBatch } = await import("./import-batch.ts");
    const { accountId } = await db.db.transaction((tx) =>
      storeBatch(
        tx,
        {
          batch: enableBankingBatch({ externalAccountId: "hash-f", ...fenster, fetchedAt: "2026-09-30T12:00:00+02:00", fetchId: "f1" }),
          binding: { provider: "enablebanking", externalAccountId: "hash-f", accountKind: "bank" },
          statement: enableBankingStatement({ account: { uid: "u", account_id: { iban }, name: "Mietkonto" }, ...fenster }),
          eventOf: entryReferenceOf(transactions),
          source: { filename: "Abruf Testbank 2026-09-30", sha256: "f1".padEnd(64, "0") },
        },
        null,
      ),
    );
    const { cutoverDates } = await import("./andere-importe.ts");
    expect((await cutoverDates()).find((c) => c.bankAccountId === accountId)).toEqual({
      bankAccountId: accountId,
      cutoverDate: "2026-08-21",
      filesBefore: true,
    });
  });

  it("nennt beim Etsy-Abruf mit Stichtag nicht den Bankabruf als Quelle (#306)", async () => {
    // Wechsel von der Etsy-CSV auf den Etsy-Abruf (Quellenbindung „etsy“ über storeBatch): Bankabruf gibt es hier nicht
    const [konto] = await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider, ledger_index)
      values ('Etsy Payments', 'zahlungsdienstleister', 'etsy', 3) returning id`;
    const csv: ParsedStatement = { format: "etsy-csv", currency: "EUR", transactions: [umsatz("2026-10-06", 1500, "Etsy Verkauf CSV")], warnings: [] };
    await db.db.transaction((tx) => bank.storeStatement(tx, csv, { filename: "etsy-oktober.csv", sha256: "etsy-oktober.csv" }, konto!.id));
    const { importEtsyLedger } = await import("../etsy/index.ts");
    const r = await importEtsyLedger(
      "test",
      [
        {
          entry_id: 1,
          amount: 2200,
          currency: "EUR",
          ledger_type: "PAYMENT_GROSS",
          reference_type: "shop_payment",
          reference_id: "5000000001",
          created_timestamp: Math.floor(new Date("2026-10-06T10:00:00Z").getTime() / 1000),
        },
      ],
      { sammelzeilen: false, reference: "2026-10-31" },
      { shopId: "shop-q", fetchFrom: "2026-10-01", now: new Date("2026-10-31T10:00:00Z") },
    );
    const quelle = r.messages.find((m) => m.includes("Stichtag"));
    expect(quelle).toContain("Seit dem Stichtag 2026-10-06");
    expect(quelle).not.toContain("Bankabruf");
  });

  it("schweigt beim Wechsel vom alten zum neuen DKB-CSV derselben Bank", async () => {
    // DKB hat das CSV-Format geändert; der Dubletten-Hash erkennt dieselben Umsätze in beiden Formaten (dedup.test.ts)
    const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/${name}`, import.meta.url)));
    const speichere = (name: string) => {
      const statement = parseStatement(fixture(name), name);
      return db.db.transaction((tx) => bank.storeStatement(tx, statement, { filename: name, sha256: name }, null));
    };
    await speichere("dkb-alt.csv");
    const r = await speichere("dkb-neu.csv");
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.added).toBeGreaterThan(0);
    expect(r.quelle).toBeNull();
  });
});
