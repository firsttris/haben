import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Gegenprobe zum angekündigten Originalrichtungsfix: Eine Aufhebung ist keine neue Steuerzahlung.
// Zufluss und spätere Gegenwirkung bleiben in ihren Jahren (§ 11 EStG).
// https://www.gesetze-im-internet.de/estg/__11.html
describe.skipIf(!testDatabaseUrl)("Unabhängige Nachprüfung 926: Steuererstattung im Folgejahr aufgehoben", () => {
  let sql: postgres.Sql;
  let reports: typeof import("./reports.ts");
  let bank: typeof import("../bank/index.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    reports = await import("./reports.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["SKR03", "ist", "ust", "steuer", "erstatteteUst"],
    ["SKR04", "soll", "ust", "steuer", "erstatteteUst"],
    ["SKR03", "ist", "gewst", "zinsen233a", "einnahmenSteuerfrei"],
    ["SKR04", "soll", "gewst", "zinsen233a", "einnahmenSteuerfrei"],
  ] as const)("%s/%s, %s/%s: Gegenwirkung bleibt dieselbe negative EÜR-Zeile", async (chart, mode, art, posten, key) => {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set journal_ab=2025`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    const transactionId = await f.transaction(500, "2025-12-15");
    await bank.allocate("review-926-tax-reversal", { kind: "steuer", transactionId, amount: 500, steuer: { art, jahr: 2024, posten } });
    const [original] = await sql`select id, to_jsonb(a)::text as value from allocations a where transaction_id=${transactionId}`;
    const originalSeal = await sql`select to_jsonb(s)::text as value from seals s where table_name='allocations' and row_id=${original!.id}`;
    expect(originalSeal).toHaveLength(1);
    const previous = await reports.euerForYear(2025);
    await bank.reverseAllocation("review-926-tax-reversal", original!.id, "2026-01-16");
    expect(await reports.euerForYear(2025)).toEqual(previous);
    expect(await sql`select to_jsonb(a)::text as value from allocations a where id=${original!.id}`).toEqual([{ value: original!.value }]);
    expect(await sql`select to_jsonb(s)::text as value from seals s where table_name='allocations' and row_id=${original!.id}`).toEqual(originalSeal);
    const lines = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) =>
      Object.fromEntries([...euer.einnahmen, ...euer.ausgaben].filter((line) => line.amount !== 0).map((line) => [line.key, line.amount]));
    expect({ journal: lines(await reports.euerForYear(2026)) }).toEqual({ journal: { [key]: -500 } });
  });
});
