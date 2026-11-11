import type { ParsedStatement, StatementFormat } from "@haben/import";
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
  let bank: typeof import("./bank.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
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
});
