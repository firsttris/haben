import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Amtliche Anleitung EÜR 2025, Zeilen 12/16/18; ausschließlich fiktive Zahlungen über den tatsächlichen Bankabgleich.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
describe.skipIf(!testDatabaseUrl)("KU-Zinsen aus Bankzahlungen in beiden EÜR-Quellen (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let reports: typeof import("./reports.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: Guthaben- und Erstattungszinsen in Zeile 12, Aufhebung in derselben Einnahme", async (chart, mode) => {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set kleinunternehmer=true, journal_ab=2026`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    const actor = "ku-zinsen-test";
    await bank.allocate(actor, { kind: "zinsertrag", transactionId: await f.transaction(1_000), amount: 1_000 });
    await bank.allocateSplit(actor, {
      transactionId: await f.transaction(9_200),
      parts: [
        { kind: "steuer", amount: 5_000, steuer: { art: "ust", jahr: 2025, posten: "steuer" } },
        { kind: "steuer", amount: 1_200, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } },
        { kind: "steuer", amount: 3_000, steuer: { art: "est", jahr: 2025, posten: "zinsen233a" } },
      ],
    });
    const readBoth = async () => Promise.all([reports.euerForYear(2026), reports.euerAusNebenbuechern(2026)]);
    const rows = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) => {
      const amount = (key: string) => euer.einnahmen.find((line) => line.key === key)?.amount ?? 0;
      return {
        z12: amount("einnahmenKleinunternehmer"),
        z16: amount("einnahmenSteuerfrei"),
        z18: amount("erstatteteUst"),
        gewinn: euer.gewinn,
        november: euer.monthly.einnahmen[10],
      };
    };
    expect((await readBoth()).map(rows)).toEqual(Array(2).fill({ z12: 2_200, z16: 0, z18: 5_000, gewinn: 7_200, november: 2_200 }));

    const [interest] = await sql`select id from allocations where kind='zinsertrag' and reverses_id is null`;
    const [refund] = await sql`select id from allocations where kind='steuer' and tax_type='ust' and tax_item='zinsen233a' and reverses_id is null`;
    await bank.reverseAllocation(actor, interest!.id, "2026-11-06");
    await bank.reverseAllocation(actor, refund!.id, "2026-11-06");
    expect((await readBoth()).map(rows)).toEqual(Array(2).fill({ z12: 0, z16: 0, z18: 0, gewinn: 0, november: 0 }));
  });
});
