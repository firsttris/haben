import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("Steuererstattung nach Gegenaufhebung in beiden EÜR-Quellen (Postgres)", () => {
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

  it.each(["steuer", "zinsen233a"] as const)("%s: am Folgetag aufgehobene Erstattung ist weder Einnahme noch Ausgabe", async (posten) => {
    const f = await turnoverFixtures(sql);
    await sql`update company set kleinunternehmer=true, journal_ab=2026`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    await bank.allocate("ku-zinsen-test", {
      kind: "steuer",
      transactionId: await f.transaction(1_200),
      amount: 1_200,
      steuer: { art: "ust", jahr: 2025, posten },
    });
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    await bank.reverseAllocation("ku-zinsen-test", allocation!.id, "2026-11-06");
    const both = await Promise.all([reports.euerForYear(2026), reports.euerAusNebenbuechern(2026)]);
    expect(both.map((euer) => ({ einnahmen: euer.totalEinnahmen, ausgaben: euer.totalAusgaben, gewinn: euer.gewinn }))).toEqual([
      { einnahmen: 0, ausgaben: 0, gewinn: 0 },
      { einnahmen: 0, ausgaben: 0, gewinn: 0 },
    ]);
  });

  it("Regelbesteuert/SKR04/Soll: Original und Gegenaufhebung bleiben über den Jahreswechsel in ihren Monaten", async () => {
    const f = await turnoverFixtures(sql, "soll", "SKR04");
    await sql`update company set kleinunternehmer=false, firmendaten_gespeichert_at=now(), journal_ab=2026`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    await bank.allocateSplit("ku-zinsen-test", {
      transactionId: await f.transaction(1_700, "2026-12-30"),
      parts: [
        { kind: "steuer", amount: 500, steuer: { art: "ust", jahr: 2025, posten: "steuer" } },
        { kind: "steuer", amount: 1_200, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } },
      ],
    });
    const [refund] = await sql`select id from allocations where tax_item='zinsen233a' and reverses_id is null`;
    await bank.reverseAllocation("ku-zinsen-test", refund!.id, "2027-01-05");
    for (const [year, sign, month] of [
      [2026, 1, 11],
      [2027, -1, 0],
    ] as const) {
      const both = await Promise.all([reports.euerForYear(year), reports.euerAusNebenbuechern(year)]);
      expect(
        both.map((euer) => {
          const amount = (key: string) => euer.einnahmen.find((line) => line.key === key)?.amount ?? 0;
          return {
            z12: amount("einnahmenKleinunternehmer"),
            z16: amount("einnahmenSteuerfrei"),
            z18: amount("erstatteteUst"),
            gewinn: euer.gewinn,
            monat: euer.monthly.einnahmen[month],
          };
        }),
      ).toEqual(Array(2).fill({ z12: 0, z16: sign * 1_200, z18: sign * 500, gewinn: sign * 1_700, monat: sign * 1_200 }));
    }
  });
});
