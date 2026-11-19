import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Amtliche EÜR-Anleitung 2025, Erläuterung zu Zeile 18: Erstattete USt-Nebenleistungen bei KU in Zeilen 12 und 13.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
describe.skipIf(!testDatabaseUrl)("Unabhängige EÜR-Gegenprobe 926: bekannte USt-Erstattungszinsen in Zeile 13", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let turnover: typeof import("./gesamtumsatz.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    turnover = await import("./gesamtumsatz.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: ausdrücklich zugeordnete USt-Erstattungszinsen erscheinen nachrichtlich ohne höheren Gewinn", async (chart, mode) => {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set kleinunternehmer=true, journal_ab=2026`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    await bank.allocate("review-926-refund-line13", {
      kind: "steuer",
      transactionId: await f.transaction(1_200),
      amount: 1_200,
      steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" },
    });
    const euer = await annual.euerYear(2026);
    expect({
      z12: euer.figures.kleinunternehmer ?? 0,
      z13: euer.figures.kleinunternehmerAbzuege ?? 0,
      z18: euer.figures.erstatteteUst ?? 0,
      gewinn: euer.gewinn,
      gesamtumsatz: (await turnover.gesamtumsatzForYear(2026)).included,
    }).toEqual({ z12: 1_200, z13: 1_200, z18: 0, gewinn: 1_200, gesamtumsatz: 0 });
  });
});
