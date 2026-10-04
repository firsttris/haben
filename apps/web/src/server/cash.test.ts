import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kassenbuch (Postgres)", () => {
  let cash: typeof import("./cash.ts");
  let documents: typeof import("./documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    cash = await import("./cash.ts");
    documents = await import("./documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate cash_entries, journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'SKR03')`;
  });

  async function cashDocument(date: string, net: number, tax: number) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, net % 256, tax % 256, 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "kassenbon.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Schreibwaren Huber", supplierUstId: "", invoiceNumber: "B-17", documentDate: date, dueDate: null,
      category: "buero", payment: "kasse", note: "", amounts: [{ taxRate: 1900, net, tax }],
    });
    return id;
  }

  it("bucht Einlage, Barbeleg und Geldtransit, nummeriert fortlaufend und lässt den Bestand nie negativ werden", async () => {
    const bon = await cashDocument("2026-10-02", 2_000, 380);
    // Ohne Geld in der Kasse lässt sich der Bon nicht bar bezahlen
    await expect(documents.bookDocument(actor, bon)).rejects.toThrow(/Kassenbestand würde am 02\.10\.2026 negativ/);
    expect(await sql`select status from documents where id = ${bon}`).toEqual([{ status: "neu" }]);

    await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5_000, text: "Wechselgeld" }, today);
    await documents.bookDocument(actor, bon);
    await cash.createCashEntry(actor, { kind: "einzahlung", date: "2026-10-03", amount: 2_000 }, today);
    await expect(cash.createCashEntry(actor, { kind: "entnahme", date: "2026-10-03", amount: 1_000 }, today)).rejects.toThrow(/negativ/);
    await expect(cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-05", amount: 100 }, today)).rejects.toThrow(/Zukunft/);
    // Eine Entnahme vor dem Bon würde den Bestand am Tag des Bons negativ machen
    await expect(cash.createCashEntry(actor, { kind: "entnahme", date: "2026-10-01", amount: 2_700 }, today)).rejects.toThrow(/02\.10\.2026/);

    const book = await cash.cashBook(2026);
    expect(book.entries.map((e) => [e.number, e.kind, e.amount, e.balance])).toEqual([
      [1, "einlage", 5_000, 5_000],
      [2, "beleg", -2_380, 2_620],
      [3, "einzahlung", -2_000, 620],
    ]);
    expect(book).toMatchObject({ opening: 0, closing: 620, current: 620 });

    const accounts = async (sourceId: string) =>
      (await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${sourceId} order by l.debit desc`).map((l) => ({ ...l }));
    expect((await accounts(bon)).at(-1)).toEqual({ account: "1000", debit: 0, credit: 2_380 });
    const transit = book.entries[2]!;
    expect(await accounts(transit.id)).toEqual([
      { account: "1360", debit: 2_000, credit: 0 },
      { account: "1000", debit: 0, credit: 2_000 },
    ]);

    // Storno als Gegenzeile; Belegzeilen und Doppelstorno nicht
    await expect(cash.reverseCashEntry(actor, book.entries[1]!.id, today)).rejects.toThrow(/Belege/);
    const storno = await cash.reverseCashEntry(actor, transit.id, today);
    expect(storno).toMatchObject({ number: 4, date: today, amount: 2_000, reversesId: transit.id });
    await expect(cash.reverseCashEntry(actor, transit.id, today)).rejects.toThrow(/bereits storniert/);
    expect((await cash.cashBook(2026)).current).toBe(2_620);

    await expect(sql`update cash_entries set amount = 1`).rejects.toThrow();
    await expect(sql`delete from cash_entries`).rejects.toThrow();

    const csv = await cash.cashBookCsv(2026);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('2;"2026-10-02";"Beleg";"Schreibwaren Huber · B-17";;23,80;26,20');

    // EÜR: bar bezahlter Beleg zählt am Belegdatum
    const reports = await import("./reports.ts");
    const payments = (await reports.euerPayments(2026)).filter((p) => p.kind === "document");
    expect(payments).toEqual([expect.objectContaining({ date: "2026-10-02", paid: 2_380 })]);
  });
});
