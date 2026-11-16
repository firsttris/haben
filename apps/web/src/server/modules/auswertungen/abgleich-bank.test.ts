import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Bank gegen Kontoauszug (#1116), Randfälle: Auszüge kommen nicht immer in zeitlicher Reihenfolge, etwa wenn erst der
 * laufende Monat und danach ältere Monate nachgeholt werden.
 */
describe.skipIf(!testDatabaseUrl)("Bank gegen Kontoauszug, Randfälle (Postgres)", () => {
  let bankAbgleich: typeof import("./abgleich-bank.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bankAbgleich = await import("./abgleich-bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Ein Auszug mit Salden und seinen Umsätzen in einer Transaktion, wie beim Import */
  async function auszug(konto: string, von: string, bis: string, anfang: number, umsaetze: [string, number][]) {
    const ende = anfang + umsaetze.reduce((s, [, b]) => s + b, 0);
    await sql.begin(async (tx) => {
      const [imp] =
        await tx`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, opening_balance, closing_balance, added, skipped)
        values (${konto}, ${`auszug-${von}.xml`}, ${crypto.randomUUID()}, 'camt', ${von}, ${bis}, ${anfang}, ${ende}, ${umsaetze.length}, 0) returning id`;
      for (const [datum, betrag] of umsaetze)
        await tx`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, dedup_hash)
          values (${konto}, ${imp!.id}, ${datum}, ${betrag}, ${crypto.randomUUID()})`;
    });
    return ende;
  }

  it("ein älterer Auszug, der nach dem neueren importiert wird, meldet keine Abweichung", async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts cascade`;
    const [konto] = await sql`insert into bank_accounts (name, iban) values ('Girokonto', 'DE02120300000000202051') returning id`;
    // Erst Februar (Anfangssaldo 1.500,00 €), danach Januar nachgeholt (endet mit 1.500,00 €)
    await auszug(konto!.id, "2026-02-01", "2026-02-28", 150_000, [["2026-02-10", 12_345]]);
    await auszug(konto!.id, "2026-01-01", "2026-01-31", 100_000, [["2026-01-15", 50_000]]);
    expect(await bankAbgleich.bankZeilen()).toEqual([]);
  }, 30_000);
});
