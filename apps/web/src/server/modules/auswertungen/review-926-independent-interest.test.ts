import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Amtliche Anleitung EÜR 2025, Zeile 12: vollständige Betriebseinnahmen der KU, ohne Zeilen 18 bis 22.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
describe.skipIf(!testDatabaseUrl)("Unabhängige KU-EÜR-Gegenprobe: betriebliche Guthabenzinsen", () => {
  let sql: postgres.Sql;
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let bank: typeof import("../bank/index.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    annual = await import("../jahreserklaerung/annual.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["SKR03", "ist", 2026],
    ["SKR04", "soll", 2026],
    ["SKR03", "ist", 2027],
    ["SKR04", "soll", 2027],
  ] as const)("%s/%s, Journal ab %i: gebuchte Guthabenzinsen des KU gehören in Zeile 12", async (chart, mode, journalAb) => {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set kleinunternehmer=true, journal_ab=${journalAb}`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    await bank.allocate("review-926-interest", { kind: "zinsertrag", transactionId: await f.transaction(500), amount: 500 });
    const euer = await annual.euerYear(2026);
    expect({
      journalZ12: euer.figures.kleinunternehmer ?? 0,
      z16: euer.figures.steuerfrei ?? 0,
      gewinn: euer.gewinn,
    }).toEqual({ journalZ12: 500, z16: 0, gewinn: 500 });
  });
});
