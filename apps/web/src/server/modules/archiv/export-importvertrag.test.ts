import { type EbTransaction, enableBankingBatch, enableBankingStatement, entryReferenceOf } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Herkunft der abgerufenen Umsätze im Jahresarchiv (#306, 3b): `bank/quellen.csv` ordnet jedem Ereignis der Bank seinen
 * Umsatz zu, mit Quelle und Stichtag, und `index.xml` beschreibt die Datei.
 */

const IBAN = "DE02500105170137075030";
const AUSGESCHLOSSEN = "DE89370400440532013000";
const text = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const buchung = (ref: string, booking_date: string, amount: string): EbTransaction => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date,
  creditor: { name: "Telekom" },
  remittance_information: [`Zahlung ${ref}`],
});

async function archiv(exporter: typeof import("./export.ts"), year: number) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of exporter.exportYear(year, new Date(`${year + 1}-01-15T10:00:00Z`))) chunks.push(chunk);
  return unzipSync(Buffer.concat(chunks));
}

describe.skipIf(!testDatabaseUrl)("Jahresarchiv: Herkunft der abgerufenen Umsätze (Postgres)", () => {
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;
  let files: Record<string, Uint8Array>;

  beforeAll(async () => {
    sql = await setupTestDb();
    exporter = await import("./export.ts");
    const { storeBatch } = await import("../bank/import-batch.ts");
    const { db } = await import("../../db/index.ts");
    const abruf = (transactions: EbTransaction[], dateFrom: string, dateTo: string, fetchId: string, iban = IBAN, hash = "hash-archiv") => ({
      batch: enableBankingBatch({
        externalAccountId: hash,
        transactions,
        balances: [],
        dateFrom,
        dateTo,
        fetchedAt: `${dateTo}T23:00:00+01:00`,
        fetchId,
      }),
      binding: { provider: "enablebanking", externalAccountId: hash, accountKind: "bank" as const },
      statement: enableBankingStatement({
        account: { uid: "u", account_id: { iban }, name: "Geschäftskonto" },
        transactions,
        balances: [],
        dateFrom,
        dateTo,
      }),
      eventOf: entryReferenceOf(transactions),
      source: { filename: `Abruf ${fetchId}`, sha256: fetchId },
    });
    await db.transaction((t) => storeBatch(t, abruf([buchung("ER-1", "2025-12-30", "10.00")], "2025-12-01", "2025-12-31", "abruf-2025"), null));
    await db.transaction((t) =>
      storeBatch(t, abruf([buchung("ER-2", "2026-01-05", "20.00"), buchung("ER-3", "2026-01-07", "30.50")], "2026-01-01", "2026-01-10", "abruf-2026"), null),
    );
    // Ein ausgeschlossenes Konto (#462) fehlt im Archiv, auch in bank/quellen.csv
    const fremd = await db.transaction((t) =>
      storeBatch(t, abruf([buchung("ER-9", "2026-01-06", "9.00")], "2026-01-01", "2026-01-10", "abruf-fremd", AUSGESCHLOSSEN, "hash-fremd"), null),
    );
    const { excludeAccount } = await import("../bank/konto-ausschliessen.ts");
    await excludeAccount("test", fremd.accountId);
    files = await archiv(exporter, 2026);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("schreibt je Ereignis des Jahres eine Zeile mit Quelle, Stichtag, Abruf und Umsatz", async () => {
    const [kopf, ...zeilen] = text(files["bank/quellen.csv"]).trim().split(/\r?\n/);
    expect(kopf).toBe("Konto;Anbieter;Kontokennung;Stichtag;Ereignis;Komponente;Art;Buchungstag;Betrag;Währung;Abruf;Übernommen;Umsatz-ID;Bewegungs-ID");
    const umsaetze = await sql<{ id: string; ref: string }[]>`select id, bank_reference as ref from bank_transactions order by booking_date`;
    const id = (ref: string) => umsaetze.find((u) => u.ref === ref)!.id;
    // Der Stichtag ist der Beginn des ersten Abrufs (Dezember 2025); ER-1 gehört ins Vorjahr
    expect(zeilen.map((z) => z.split(";").slice(0, 11))).toEqual([
      [IBAN, "enablebanking", "hash-archiv", "2025-12-01", "ER-2", "main", "payment", "2026-01-05", "-20,00", "EUR", "abruf-2026"],
      [IBAN, "enablebanking", "hash-archiv", "2025-12-01", "ER-3", "main", "payment", "2026-01-07", "-30,50", "EUR", "abruf-2026"],
    ]);
    expect(zeilen.map((z) => z.split(";")[12])).toEqual([id("ER-2"), id("ER-3")]);
  });

  it("beschreibt die Datei in index.xml und nennt sie in der LIESMICH", () => {
    const xml = text(files["index.xml"]);
    const teil = xml.slice(xml.indexOf("<URL>bank/quellen.csv</URL>"), xml.indexOf("</Table>", xml.indexOf("<URL>bank/quellen.csv</URL>")));
    expect(teil).toContain("<Name>Betrag</Name>");
    expect(teil).toMatch(/<Name>Betrag<\/Name>\s*<Numeric>/);
    expect(teil).toMatch(/<Name>Stichtag<\/Name>\s*<Date>/);
    expect(teil).toMatch(/<Name>Buchungstag<\/Name>\s*<Date>/);
    expect(text(files["LIESMICH.txt"])).toContain("bank/quellen.csv");
  });

  it("lässt die Datei in einem Jahr ohne abgerufene Umsätze weg", async () => {
    expect(Object.keys(await archiv(exporter, 2024))).not.toContain("bank/quellen.csv");
  });
});
