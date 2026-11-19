import { type EbBalance, type EbTransaction, enableBankingBatch, enableBankingStatement, entryReferenceOf } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { BankError } from "./bank-error.ts";

/*
 * Weg aus einem Konflikt (#306, 3b): Die Bank liefert einen schon übernommenen Umsatz mit anderem Betrag. Haben hält den
 * Konflikt fest, bis der Nutzer ihn klärt; danach läuft der Abruf des Kontos wieder.
 */

const buchung = (ref: string, booking_date: string, amount: string): EbTransaction => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date,
  creditor: { name: "Hosting Nord GmbH" },
  remittance_information: [`Kundennummer 4711 ${ref}`],
});

describe.skipIf(!testDatabaseUrl)("Konflikt klären (Postgres)", () => {
  let sql: postgres.Sql;
  let storeBatch: typeof import("./import-batch.ts").storeBatch;
  let konflikt: typeof import("./import-konflikt.ts");
  let db: typeof import("../../db/index.ts").db;
  let n = 0;

  /** Ein Abruf wie in syncConnection: angenommen, oder abgelehnt und mit der Meldung im Importprotokoll */
  async function abruf(iban: string, hash: string, transactions: EbTransaction[], balances: EbBalance[] = []) {
    const fenster = { transactions, balances, dateFrom: "2026-11-01", dateTo: "2026-11-18" };
    const fetchId = `abruf-${++n}`;
    const input = {
      batch: enableBankingBatch({ externalAccountId: hash, ...fenster, fetchedAt: "2026-11-18T12:00:00+01:00", fetchId }),
      binding: { provider: "enablebanking", externalAccountId: hash, accountKind: "bank" as const },
      statement: enableBankingStatement({ account: { uid: "u", account_id: { iban }, name: "Geschäftskonto" }, ...fenster }),
      eventOf: entryReferenceOf(transactions),
      source: { filename: `Abruf Testbank ${fetchId}`, sha256: fetchId.padEnd(64, "0") },
    };
    const [account] = await sql<{ id: string }[]>`select id from bank_accounts where iban = ${iban}`;
    try {
      return { ok: true as const, result: await db.transaction((t) => storeBatch(t, input, account?.id ?? null)) };
    } catch (error) {
      await db.transaction((t) => konflikt.recordRefusedBatch(t, account!.id, input, error as BankError));
      return { ok: false as const, message: (error as Error).message };
    }
  }

  const umsaetze = (iban: string) =>
    sql<{ id: string; amount: number }[]>`select t.id, t.amount from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
      where a.iban = ${iban} order by t.created_at`;

  beforeAll(async () => {
    sql = await setupTestDb();
    ({ storeBatch } = await import("./import-batch.ts"));
    konflikt = await import("./import-konflikt.ts");
    ({ db } = await import("../../db/index.ts"));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("hält einen Konflikt einmal fest, mit bisherigem und geliefertem Umsatz", async () => {
    const iban = "DE02120300000000202051";
    await abruf(iban, "hash-1", [buchung("ER-1", "2026-11-15", "89.00")]);
    for (const _ of [1, 2]) expect((await abruf(iban, "hash-1", [buchung("ER-1", "2026-11-15", "98.00")])).ok).toBe(false);
    const offen = (await konflikt.openConflicts()).filter((k) => k.sourceEventId === "ER-1");
    expect(offen).toHaveLength(1);
    expect(offen[0]).toMatchObject({
      previous: { bookingDate: "2026-11-15", amount: -8900, counterpartyName: "Hosting Nord GmbH", open: -8900 },
      delivered: { bookingDate: "2026-11-15", amount: -9800, currency: "EUR", counterpartyName: "Hosting Nord GmbH", purpose: "Kundennummer 4711 ER-1" },
    });
    // Der Konflikt verweist auf den ersten abgelehnten Abruf im Importprotokoll
    const [eintrag] = await sql<{ warnings: string[] }[]>`select i.warnings from import_conflicts c join bank_imports i on i.id = c.bank_import_id`;
    expect(eintrag!.warnings[0]).toMatch(/Konflikt mit schon übernommenen Umsätzen: ER-1\/main/);
    expect(await umsaetze(iban)).toHaveLength(1);
  });

  it("„Bisherigen behalten“: der gelieferte Betrag gilt danach als bekannt, ein dritter ist wieder ein Konflikt", async () => {
    const iban = "DE89370400440532013000";
    await abruf(iban, "hash-2", [buchung("ER-2", "2026-11-15", "89.00")]);
    await abruf(iban, "hash-2", [buchung("ER-2", "2026-11-15", "98.00")]);
    const [k] = (await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-2");
    expect(await konflikt.resolveConflict("test", { conflictId: k!.id, decision: "keep" })).toEqual({ transactionId: null });
    expect((await konflikt.openConflicts()).some((c) => c.sourceEventId === "ER-2")).toBe(false);

    const weiter = await abruf(iban, "hash-2", [buchung("ER-2", "2026-11-15", "98.00"), buchung("ER-3", "2026-11-16", "5.00")]);
    expect(weiter.ok).toBe(true);
    expect((await umsaetze(iban)).map((u) => u.amount)).toEqual([-8900, -500]);
    // Der bisherige Betrag bleibt ebenfalls bekannt
    expect((await abruf(iban, "hash-2", [buchung("ER-2", "2026-11-15", "89.00")])).ok).toBe(true);
    expect((await abruf(iban, "hash-2", [buchung("ER-2", "2026-11-15", "97.00")])).ok).toBe(false);
    expect((await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-2").map((c) => c.delivered.amount)).toEqual([-9700]);
  });

  it("„Als weiteren Umsatz übernehmen“: legt ihn an, zeigt den Bezug an beiden Umsätzen und lässt den Kontostand stehen", async () => {
    const iban = "DE75512108001245126199";
    const saldo: EbBalance[] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "1500.00" }, reference_date: "2026-11-18" }];
    await abruf(iban, "hash-3", [buchung("ER-4", "2026-11-18", "89.00")], saldo);
    await abruf(iban, "hash-3", [buchung("ER-4", "2026-11-18", "98.00")]);
    const [k] = (await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-4");
    const { transactionId } = await konflikt.resolveConflict("test", { conflictId: k!.id, decision: "add" });
    const [bisher, neu] = await umsaetze(iban);
    expect(neu).toEqual({ id: transactionId, amount: -9800 });
    expect(await konflikt.klaerungView(bisher!.id)).toEqual({
      provider: "enablebanking",
      added: [{ id: transactionId, bookingDate: "2026-11-18", amount: -9800 }],
      previous: null,
    });
    expect(await konflikt.klaerungView(transactionId!)).toEqual({
      provider: "enablebanking",
      added: [],
      previous: { id: bisher!.id, bookingDate: "2026-11-18", amount: -8900 },
    });
    // Der Eintrag der Klärung im Importprotokoll setzt keinen Kontostand: es bleibt der des letzten Abrufs
    const { listAccounts } = await import("./index.ts");
    const konto = (await listAccounts()).find((a) => a.iban === iban)!;
    expect(konto.lastImport?.closingBalance).toBe(150000);
    // Der nächste Abruf mit dem gelieferten Betrag legt nichts noch einmal an
    expect((await abruf(iban, "hash-3", [buchung("ER-4", "2026-11-18", "98.00")])).ok).toBe(true);
    expect(await umsaetze(iban)).toHaveLength(2);
  });

  it("hält keinen Konflikt fest, wenn der Abruf aus einem anderen Grund abgelehnt wurde (Quelle an einem anderen Konto)", async () => {
    await abruf("DE91100000000123456789", "hash-5", [buchung("ER-6", "2026-11-15", "20.00")]);
    // Dieselbe Kennung der Bank kommt mit einem anderen Konto: sourceFor lehnt ab, ehe es zum Abgleich kommt
    const anderes = "DE27100777770209299700";
    await sql`insert into bank_accounts (name, iban) values ('Anderes Konto', ${anderes})`;
    const r = await abruf(anderes, "hash-5", [buchung("ER-6", "2026-11-15", "21.00")]);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("anderen Konto") });
    expect((await konflikt.openConflicts()).filter((k) => k.sourceEventId === "ER-6")).toEqual([]);
  });

  it("behandelt eine ausdrücklich als weiterer Umsatz geklärte Quellenreferenz bei der Bestandsprüfung als bekannt", async () => {
    const iban = "DE02100500000054540447";
    const normal = buchung("ER-BESTAND", "2026-11-15", "89.00");
    const anderer = { ...buchung("ER-ANDERS", "2026-11-15", "98.00"), remittance_information: ["Kundennummer 4711 ER-BESTAND X"] };
    expect((await abruf(iban, "hash-bestand", [normal, anderer])).ok).toBe(true);
    expect((await abruf(iban, "hash-bestand", [{ ...normal, transaction_amount: { amount: "98.00", currency: "EUR" } }])).ok).toBe(false);
    const [k] = (await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-BESTAND");
    const { transactionId } = await konflikt.resolveConflict("test", { conflictId: k!.id, decision: "add" });
    expect(transactionId).not.toBeNull();
    const { runExistingDuplicateCheck } = await import("./duplicate-scan.ts");
    expect(await runExistingDuplicateCheck()).not.toBeNull();
    const reviews = await sql`select id from bank_duplicate_reviews where transaction_id = ${transactionId}`;
    expect(reviews).toEqual([]);
  });

  it("nimmt den Umsatz aus der Bewegung, wenn der Auszug keinen zum Ereignis hat (etwa eine Gebühr als Komponente)", async () => {
    const iban = "DE02500105170137075030";
    await abruf(iban, "hash-6", [buchung("ER-7", "2026-11-14", "30.00")]);
    const [bewegung] = await sql<{ id: string; account: string }[]>`select m.id, s.bank_account_id as account from import_movements m
      join import_sources s on s.id = m.source_id where m.source_event_id = 'ER-7'`;
    const { MovementConflictError } = await import("./import-batch.ts");
    const gebuehr = {
      sourceEventId: "ER-7",
      component: "fee" as const,
      kind: "fee" as const,
      bookingDate: "2026-11-14",
      amount: -150 as never,
      currency: "EUR",
      counterpartyName: "Testbank",
      purpose: "Gebühr ER-7",
      references: {},
    };
    const fenster = { transactions: [], balances: [], dateFrom: "2026-11-01", dateTo: "2026-11-18" };
    const input = {
      batch: enableBankingBatch({ externalAccountId: "hash-6", ...fenster, fetchedAt: "2026-11-18T12:00:00+01:00", fetchId: "gebuehr" }),
      binding: { provider: "enablebanking", externalAccountId: "hash-6", accountKind: "bank" as const },
      statement: enableBankingStatement({ account: { uid: "u", account_id: { iban }, name: "Geschäftskonto" }, ...fenster }),
      eventOf: () => undefined,
      source: { filename: "Abruf Testbank gebuehr", sha256: "gebuehr".padEnd(64, "0") },
    };
    const fehler = new MovementConflictError("Konflikt", [{ movementId: bewegung!.id, movement: gebuehr }]);
    await db.transaction((t) => konflikt.recordRefusedBatch(t, bewegung!.account, input, fehler));
    const [k] = (await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-7");
    expect(k!.delivered).toEqual({ bookingDate: "2026-11-14", amount: -150, currency: "EUR", counterpartyName: "Testbank", purpose: "Gebühr ER-7" });
  });

  it("klärt einen Konflikt nur einmal", async () => {
    const iban = "DE12500105170648489890";
    await abruf(iban, "hash-4", [buchung("ER-5", "2026-11-15", "10.00")]);
    await abruf(iban, "hash-4", [buchung("ER-5", "2026-11-15", "11.00")]);
    const [k] = (await konflikt.openConflicts()).filter((c) => c.sourceEventId === "ER-5");
    await konflikt.resolveConflict("test", { conflictId: k!.id, decision: "keep" });
    await expect(konflikt.resolveConflict("test", { conflictId: k!.id, decision: "add" })).rejects.toThrow("schon geklärt");
    expect(await umsaetze(iban)).toHaveLength(1);
  });
});
