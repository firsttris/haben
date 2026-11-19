import { type EbTransaction, enableBankingBatch, enableBankingStatement, entryReferenceOf } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Herkunft der abgerufenen Umsätze im Jahresarchiv (#306, 3b): `bank/quellen.csv` ordnet jedem Ereignis (Bankabruf oder Etsy)
 * seinen Umsatz zu, mit Quelle und Stichtag, und `index.xml` beschreibt die Datei.
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
    const januar = abruf([buchung("ER-2", "2026-01-05", "20.00"), buchung("ER-3", "2026-01-07", "30.50")], "2026-01-01", "2026-01-10", "abruf-2026");
    // Alle Referenzen des Vertrags an einer Bewegung, damit jede Spalte von bank/quellen.csv ihren Wert zeigt
    januar.batch.movements[1]!.references = {
      providerReference: "ER-3",
      eventCode: "PMNT-ICDT-STDO",
      endToEndId: "E2E-3",
      relatedEventId: "ER-2",
      payoutId: "PO-1",
      orderId: "12-34567-89012",
    };
    await db.transaction((t) => storeBatch(t, januar, null));
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
    expect(kopf).toBe(
      "Konto;Anbieter;Kontokennung;Stichtag;Ereignis;Komponente;Art;Buchungstag;Betrag;Währung;Import-ID;Übernommen;Umsatz-ID;Bewegungs-ID;" +
        "Anbieterreferenz;Ereigniscode;EndToEndId;Bezug;Auszahlung;Bestellung",
    );
    const umsaetze = await sql<{ id: string; ref: string }[]>`select id, bank_reference as ref from bank_transactions order by booking_date`;
    const id = (ref: string) => umsaetze.find((u) => u.ref === ref)!.id;
    // Der Stichtag ist der Beginn des ersten Abrufs (Dezember 2025); ER-1 gehört ins Vorjahr
    const [lauf] = await sql<{ id: string }[]>`select bank_import_id as id from import_batches where fetch_id = 'abruf-2026'`;
    expect(zeilen.map((z) => z.split(";").slice(0, 11))).toEqual([
      [IBAN, "enablebanking", "hash-archiv", "2025-12-01", "ER-2", "main", "payment", "2026-01-05", "-20,00", "EUR", lauf!.id],
      [IBAN, "enablebanking", "hash-archiv", "2025-12-01", "ER-3", "main", "payment", "2026-01-07", "-30,50", "EUR", lauf!.id],
    ]);
    expect(zeilen.map((z) => z.split(";")[12])).toEqual([id("ER-2"), id("ER-3")]);
    // Referenzen der Lieferung (#306, Schritt 4), in der Reihenfolge des Kopfs
    expect(zeilen.map((z) => z.split(";").slice(14))).toEqual([
      ["ER-2", "", "", "", "", ""],
      ["ER-3", "PMNT-ICDT-STDO", "E2E-3", "ER-2", "PO-1", "12-34567-89012"],
    ]);
  });

  it("verweist in „Abruf“ auf eine Lieferung, die bank/importe.csv desselben Archivs nennt", async () => {
    const { storeBatch } = await import("../bank/import-batch.ts");
    const { db } = await import("../../db/index.ts");
    const transactions = [buchung("ER-20", "2027-01-05", "20.00")];
    const hash = "hash-abruf-2027";
    const fenster = { transactions, balances: [], dateFrom: "2027-01-01", dateTo: "2027-01-10" };
    // Wie syncConnection: Dateiname „Abruf <Bank> <Tag>“ und SHA-256 der Antwort, die zufällige fetchId steht in keinem davon
    await db.transaction((t) =>
      storeBatch(
        t,
        {
          batch: enableBankingBatch({ externalAccountId: hash, ...fenster, fetchedAt: "2027-01-10T23:00:00+01:00", fetchId: "9f3c2a71d04be655" }),
          binding: { provider: "enablebanking", externalAccountId: hash, accountKind: "bank" },
          statement: enableBankingStatement({ account: { uid: "u2", account_id: { iban: "DE75512108001245126199" }, name: "Zweitkonto" }, ...fenster }),
          eventOf: entryReferenceOf(transactions),
          source: { filename: "Abruf Testbank 2027-01-10", sha256: "c0ffee".padEnd(64, "0") },
        },
        null,
      ),
    );
    const archiv2027 = await archiv(exporter, 2027);
    const [, ...zeilen] = text(archiv2027["bank/quellen.csv"]).trim().split(/\r?\n/);
    const importe = text(archiv2027["bank/importe.csv"])
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((z) => z.split(";"));
    for (const zeile of zeilen) {
      const abrufWert = zeile.split(";")[10]!;
      // Die Lieferung muss sich im Importprotokoll des Archivs finden lassen, sonst führt die Spalte ins Leere
      expect(
        importe.some((i) => i.includes(abrufWert)),
        `Abruf ${abrufWert} fehlt in bank/importe.csv`,
      ).toBe(true);
    }
    expect(zeilen).toHaveLength(1);
  });

  it("nimmt die Lieferung eines Umsatzes vom Jahresende auch ins Importprotokoll dieses Jahres", async () => {
    const { storeBatch } = await import("../bank/import-batch.ts");
    const { storeStatement } = await import("../bank/index.ts");
    const { db } = await import("../../db/index.ts");
    const iban = "DE12500105170648489890";
    const hash = "hash-jahresende";
    const konto = { uid: "u3", account_id: { iban }, name: "Drittkonto" };
    const lieferung = (transactions: EbTransaction[], dateFrom: string, dateTo: string, fetchId: string) => ({
      batch: enableBankingBatch({ externalAccountId: hash, transactions, balances: [], dateFrom, dateTo, fetchedAt: `${dateTo}T23:00:00+01:00`, fetchId }),
      binding: { provider: "enablebanking", externalAccountId: hash, accountKind: "bank" as const },
      statement: enableBankingStatement({ account: konto, transactions, balances: [], dateFrom, dateTo }),
      eventOf: entryReferenceOf(transactions),
      source: { filename: `Abruf Testbank ${dateTo}`, sha256: fetchId.padEnd(64, "0") },
    });
    // Bindung im Dezember, danach eine Datei für die letzten Tage des Jahres (etwa eine Lücke)
    await db.transaction((t) => storeBatch(t, lieferung([buchung("ER-31", "2026-12-05", "31.00")], "2026-12-01", "2026-12-20", "a1"), null));
    const datei = {
      ...enableBankingStatement({
        account: konto,
        transactions: [buchung("ER-32", "2026-12-30", "32.00")],
        balances: [],
        dateFrom: "2026-12-21",
        dateTo: "2026-12-31",
      }),
      format: "camt053" as const,
    };
    await db.transaction((t) => storeStatement(t, datei, { filename: "dezember.xml", sha256: "d".repeat(64) }, null));
    // Die Bank filtert nach Valuta: ER-32 vom 30.12. kommt im Januar vor dem Fenster und wird mit der Zeile der Datei verbunden
    await db.transaction((t) => storeBatch(t, lieferung([buchung("ER-32", "2026-12-30", "32.00")], "2027-01-01", "2027-01-10", "b2"), null));
    const [januar] = await sql<{ id: string }[]>`select bank_import_id as id from import_batches where fetch_id = 'b2'`;
    const archiv2026 = await archiv(exporter, 2026);
    expect(text(archiv2026["bank/quellen.csv"])).toContain(";ER-32;");
    // Die Zeile in bank/quellen.csv nennt diese Lieferung; das Importprotokoll desselben Archivs muss sie enthalten
    const importIds = text(archiv2026["bank/importe.csv"])
      .trim()
      .split(/\r?\n/)
      .map((z) => z.split(";").at(-1));
    expect(importIds).toContain(januar!.id);
  });

  it("schreibt je geklärtem Konflikt eine Zeile nach bank/klaerungen.csv, mit dem abgelehnten Abruf im Importprotokoll", async () => {
    const { MovementConflictError, storeBatch } = await import("../bank/import-batch.ts");
    const konflikt = await import("../bank/import-konflikt.ts");
    const { db } = await import("../../db/index.ts");
    const iban = "DE91100000000123456789";
    const lieferung = (amount: string, fetchId: string) => {
      const transactions = [buchung("ER-40", "2026-03-10", amount)];
      const fenster = { transactions, balances: [], dateFrom: "2026-03-01", dateTo: "2026-03-20" };
      return {
        batch: enableBankingBatch({ externalAccountId: "hash-klaerung", ...fenster, fetchedAt: "2026-03-20T23:00:00+01:00", fetchId }),
        binding: { provider: "enablebanking", externalAccountId: "hash-klaerung", accountKind: "bank" as const },
        statement: enableBankingStatement({ account: { uid: "u4", account_id: { iban }, name: "Klärkonto" }, ...fenster }),
        eventOf: entryReferenceOf(transactions),
        source: { filename: `Abruf Testbank ${fetchId}`, sha256: fetchId.padEnd(64, "0") },
      };
    };
    const { accountId } = await db.transaction((t) => storeBatch(t, lieferung("89.00", "k1"), null));
    const zweite = lieferung("98.00", "k2");
    const fehler = await db.transaction((t) => storeBatch(t, zweite, accountId)).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(MovementConflictError);
    await db.transaction((t) => konflikt.recordRefusedBatch(t, accountId, zweite, fehler as InstanceType<typeof MovementConflictError>));
    const [offen] = (await konflikt.openConflicts()).filter((k) => k.sourceEventId === "ER-40");
    const { transactionId } = await konflikt.resolveConflict("inhaber-1", { conflictId: offen!.id, decision: "add" });

    const archiv2026 = await archiv(exporter, 2026);
    const [kopf, ...zeilen] = text(archiv2026["bank/klaerungen.csv"]).trim().split(/\r?\n/);
    expect(kopf).toBe(
      "Konto;Ereignis;Komponente;Buchungstag bisher;Betrag bisher;Art bisher;Buchungstag geliefert;Betrag geliefert;Art geliefert;Währung;Konflikt seit;Import-ID;Entscheidung;Umsatz-ID bisher;Umsatz-ID neu;Geklärt von;Geklärt am;Klärungs-ID",
    );
    const zeile = zeilen[0]!.split(";");
    expect(zeilen).toHaveLength(1);
    expect(zeile.slice(0, 10)).toEqual([iban, "ER-40", "main", "2026-03-10", "-89,00", "payment", "2026-03-10", "-98,00", "payment", "EUR"]);
    expect(zeile.slice(12, 16)).toEqual(["Als weiteren Umsatz übernommen", offen!.previous.id, transactionId, "inhaber-1"]);
    // Der abgelehnte Abruf hat keinen Zeitraum; er steht trotzdem im Importprotokoll dieses Archivs
    const importIds = text(archiv2026["bank/importe.csv"])
      .trim()
      .split(/\r?\n/)
      .map((z) => z.split(";").at(-1));
    expect(importIds).toContain(zeile[11]);
    const xml = text(archiv2026["index.xml"]);
    const teil = xml.slice(xml.indexOf("<URL>bank/klaerungen.csv</URL>"), xml.indexOf("</Table>", xml.indexOf("<URL>bank/klaerungen.csv</URL>")));
    expect(teil).toMatch(/<Name>Betrag geliefert<\/Name>\s*<Numeric>/);
    expect(teil).toMatch(/<Name>Buchungstag bisher<\/Name>\s*<Date>/);
    expect(text(archiv2026["LIESMICH.txt"])).toContain("bank/klaerungen.csv");
  });

  it("zeigt eine Klärung über den Jahreswechsel auch im Archiv des neuen Umsatzes", async () => {
    const { MovementConflictError, storeBatch } = await import("../bank/import-batch.ts");
    const konflikt = await import("../bank/import-konflikt.ts");
    const { db } = await import("../../db/index.ts");
    const iban = "DE27100777770209299700";
    const lieferung = (datum: string, fetchId: string) => {
      const transactions = [buchung("ER-50", datum, "50.00")];
      const fenster = { transactions, balances: [], dateFrom: "2026-12-20", dateTo: "2027-01-05" };
      return {
        batch: enableBankingBatch({ externalAccountId: "hash-wechsel", ...fenster, fetchedAt: "2027-01-05T23:00:00+01:00", fetchId }),
        binding: { provider: "enablebanking", externalAccountId: "hash-wechsel", accountKind: "bank" as const },
        statement: enableBankingStatement({ account: { uid: "u5", account_id: { iban }, name: "Wechselkonto" }, ...fenster }),
        eventOf: entryReferenceOf(transactions),
        source: { filename: `Abruf Testbank ${fetchId}`, sha256: fetchId.padEnd(64, "0") },
      };
    };
    // Die Bank verschiebt den Buchungstag über den Jahreswechsel; der Nutzer übernimmt den gelieferten als weiteren Umsatz
    const { accountId } = await db.transaction((t) => storeBatch(t, lieferung("2026-12-30", "w1"), null));
    const zweite = lieferung("2027-01-02", "w2");
    const fehler = await db.transaction((t) => storeBatch(t, zweite, accountId)).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(MovementConflictError);
    await db.transaction((t) => konflikt.recordRefusedBatch(t, accountId, zweite, fehler as InstanceType<typeof MovementConflictError>));
    const [offen] = (await konflikt.openConflicts()).filter((k) => k.sourceEventId === "ER-50");
    const { transactionId } = await konflikt.resolveConflict("inhaber-1", { conflictId: offen!.id, decision: "add" });

    for (const jahr of [2026, 2027]) {
      const dateien = await archiv(exporter, jahr);
      const zeilen = text(dateien["bank/klaerungen.csv"])
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .filter((z) => z.includes(";ER-50;"));
      expect(
        zeilen.map((z) => z.split(";")[14]),
        `Archiv ${jahr}`,
      ).toEqual([transactionId]);
      const importIds = text(dateien["bank/importe.csv"])
        .trim()
        .split(/\r?\n/)
        .map((z) => z.split(";").at(-1));
      expect(importIds, `Archiv ${jahr}`).toContain(zeilen[0]!.split(";")[11]);
    }
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
