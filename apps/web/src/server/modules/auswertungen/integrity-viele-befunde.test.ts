import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Die Prüfung zeigt je Art und Tabelle höchstens 100 Befunde; erreicht eine Tabelle die Grenze, sagt die Meldung
 * „oder mehr“ (truncated in integrity.ts). Fehlen Siegel aus mehreren Tabellen, darf die Grenze keine Befunde
 * abschneiden, ohne dass die Meldung das sagt. Eigene Datei, weil der Fall festgeschrieben bleibt und keine
 * Transaktion zurückgerollt werden kann: checkIntegrity liest über die eigene Verbindung der App.
 */
describe.skipIf(!testDatabaseUrl)("Integritätsprüfung: viele fehlende Siegel (Postgres)", () => {
  let sql: postgres.Sql;
  let integrity: typeof import("./integrity.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    integrity = await import("./integrity.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("zeigt alle fehlenden Siegel aus zwei Tabellen oder meldet „oder mehr“", async () => {
    const je = 60;
    const entries = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        select '2026-01-10', 'Buchung ' || i, 'invoice', gen_random_uuid(), 'SKR03' from generate_series(1, ${je}) i returning id`;
      const ids = rows.map((r) => r.id);
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        select id, '1400', 11900, 0 from unnest(${ids}::uuid[]) id
        union all select id, '8400', 0, 11900 from unnest(${ids}::uuid[]) id`;
      await tx`update journal_entries set locked_at = now() where id = any(${ids}::uuid[])`;
      return ids;
    });
    const cash = (
      await sql<{ id: string }[]>`insert into cash_entries (number, date, amount, kind, text)
        select i, '2026-03-01', 100, 'einlage', 'Einlage ' || i from generate_series(1, ${je}) i returning id`
    ).map((r) => r.id);
    const ids = [...entries, ...cash];
    const [{ n }] = (await sql`select count(*)::int as n from seals where row_id = any(${ids}::uuid[])`) as unknown as [{ n: number }];
    expect(n).toBe(2 * je);

    // Datensätze samt Siegel an den Triggern vorbei gelöscht
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from journal_lines where entry_id = any(${entries}::uuid[])`;
      await tx`delete from journal_entries where id = any(${entries}::uuid[])`;
      await tx`delete from cash_entries where id = any(${cash}::uuid[])`;
      await tx`delete from seals where row_id = any(${ids}::uuid[])`;
    });

    const report = await integrity.checkIntegrity();
    expect(new Set(report.problems.map((p) => p.befund))).toEqual(new Set(["Siegel fehlt, steht aber im Audit-Log"]));
    const shown = report.problems.length;
    expect(
      report.truncated || shown === 2 * je,
      `${shown} Befunde ohne „oder mehr“, es fehlen aber ${2 * je} Siegel (Buchungen ${report.problems.filter((p) => p.tabelle === "journal_entries").length}, Kasse ${report.problems.filter((p) => p.tabelle === "cash_entries").length})`,
    ).toBe(true);
  }, 60_000);
});
