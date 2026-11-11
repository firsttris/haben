import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Sachkonten (#270): Die Saldenliste zeigt ein eigenes Konto mit seiner Nummer und seinem Namen. E-Bilanz, HGB und
 * Körperschaftsteuer rechnen nach Kontonummer und bekommen die Liste „aufgelöst“: ein eigenes Konto zählt dort auf dem Konto
 * seiner Elternkategorie, zusammen mit dessen Buchungen.
 */

describe.skipIf(!testDatabaseUrl)("Saldenliste mit eigenen Konten (Postgres, #270)", () => {
  let sql: postgres.Sql;
  let ledger: typeof import("./ledger.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    ledger = await import("./ledger.ts");
    konten = await import("../eigene-konten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate own_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
    await konten.createOwnAccount(actor, { account: "4999", name: "Software: Entwicklung", parentCategory: "software" });
    for (const [aufwand, betrag] of [
      ["4964", 5000],
      ["4999", 10000],
    ] as const) {
      await sql.begin(async (tx) => {
        const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values ('2026-03-02', 'Eingangsrechnung', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, ${aufwand}, ${betrag}, 0), (${e!.id}, '1200', 0, ${betrag})`;
        await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
      });
    }
  });

  const range = () => ledger.ledgerRange(2026);

  it("zeigt das eigene Konto mit Nummer und Name neben dem Konto der Kategorie", async () => {
    const rows = await ledger.saldenliste(range());
    expect(rows.filter((r) => r.account.startsWith("49")).map((r) => [r.account, r.name, r.saldo])).toEqual([
      ["4964", expect.stringContaining("Software"), 5000],
      ["4999", "Software: Entwicklung", 10000],
    ]);
  });

  it("aufgelöst liegt das eigene Konto auf dem Konto der Elternkategorie, summiert mit dessen Buchungen", async () => {
    const rows = await ledger.saldenliste(range(), { aufgeloest: true });
    expect(rows.filter((r) => r.account.startsWith("49")).map((r) => [r.account, r.saldo, r.soll, r.sollJahr])).toEqual([["4964", 15000, 15000, 15000]]);
    expect(rows.find((r) => r.account === "1200")!.saldo).toBe(-15000);
  });
});
