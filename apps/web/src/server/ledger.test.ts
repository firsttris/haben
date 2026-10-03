import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Saldenliste und Kontenblatt (Postgres)", () => {
  let ledger: typeof import("./ledger.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    ledger = await import("./ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function entry(date: string, description: string, lines: [string, number, number][]) {
    const [e] = await sql`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
      values (${date}, ${description}, 'invoice', gen_random_uuid(), 'SKR03') returning id`;
    for (const [account, debit, credit] of lines) {
      await sql`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, ${account}, ${debit}, ${credit})`;
    }
  }

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries cascade`;
    await entry("2025-12-30", "Vorjahr", [["1200", 99_900, 0], ["8400", 0, 99_900]]);
    await entry("2026-01-10", "Rechnung RE-1", [["1400", 119_000, 0], ["8400", 0, 100_000], ["1776", 0, 19_000]]);
    await entry("2026-02-03", "Zahlung RE-1", [["1200", 119_000, 0], ["1400", 0, 119_000]]);
    await entry("2026-02-20", "Bürobedarf", [["4930", 5_000, 0], ["1576", 950, 0], ["1200", 0, 5_950]]);
  });

  it("rechnet Saldenliste mit Eröffnung ab Jahresbeginn, ohne Vorjahr", async () => {
    const jahr = await ledger.saldenliste(ledger.ledgerRange(2026));
    expect(jahr.map((r) => [r.account, r.eroeffnung, r.soll, r.haben, r.saldo])).toEqual([
      ["1200", 0, 119_000, 5_950, 113_050],
      ["1400", 0, 119_000, 119_000, 0],
      ["1576", 0, 950, 0, 950],
      ["1776", 0, 0, 19_000, -19_000],
      ["4930", 0, 5_000, 0, 5_000],
      ["8400", 0, 0, 100_000, -100_000],
    ]);
    expect(jahr.find((r) => r.account === "4930")?.name).toBe("Bürobedarf");
    // Soll gleich Haben
    expect(jahr.reduce((s, r) => s + r.saldo, 0)).toBe(0);

    const februar = await ledger.saldenliste(ledger.ledgerRange(2026, "m2"));
    const forderungen = februar.find((r) => r.account === "1400")!;
    expect([forderungen.eroeffnung, forderungen.soll, forderungen.haben, forderungen.saldo]).toEqual([119_000, 0, 119_000, 0]);
    expect(februar.find((r) => r.account === "8400")).toMatchObject({ eroeffnung: -100_000, soll: 0, haben: 0, saldo: -100_000 });
  });

  it("zeigt im Kontenblatt Gegenkonten und laufenden Saldo", async () => {
    const blatt = await ledger.kontenblatt("1200", ledger.ledgerRange(2026, "q1"));
    expect(blatt.name).toBeTruthy();
    expect(blatt.eroeffnung).toBe(0);
    expect(blatt.zeilen.map((z) => [z.date, z.gegenkonten, z.soll, z.haben, z.saldo])).toEqual([
      ["2026-02-03", ["1400"], 119_000, 0, 119_000],
      ["2026-02-20", ["4930", "1576"], 0, 5_950, 113_050],
    ]);
    const maerz = await ledger.kontenblatt("1200", ledger.ledgerRange(2026, "m3"));
    expect(maerz).toMatchObject({ eroeffnung: 113_050, zeilen: [], saldo: 113_050 });
  });

  it("kennt Monat, Quartal und Jahr", () => {
    expect(ledger.ledgerRange(2026, "m12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(ledger.ledgerRange(2026, "q2")).toEqual({ from: "2026-04-01", to: "2026-07-01" });
    expect(ledger.ledgerRange(2026)).toEqual({ from: "2026-01-01", to: "2027-01-01" });
  });
});
