import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Amtliche EÜR 2025, Zeilen 12/13: vollständige KU-Einnahmen, nicht steuerbare Umsätze nur nachrichtlich.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
// Reale Anwendungswege; ausschließlich synthetische Zahlungen auf eigener Testdatenbank.
describe.skipIf(!testDatabaseUrl)("Unabhängige Nachprüfung 926: sonstige KU-Einnahmen", () => {
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
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: Mahnerlöse eines KU stehen in Zeile 12 und nachrichtlich 13", async (chart, mode) => {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set kleinunternehmer=true, journal_ab=2026`;
    await bank.allocate("review-926-independent", { kind: "mahnerloes", transactionId: await f.transaction(500), amount: 500 });
    const euer = await annual.euerYear(2026);
    expect({
      journalZ12: euer.figures.kleinunternehmer ?? 0,
      z13: euer.figures.kleinunternehmerAbzuege ?? 0,
      z16: euer.figures.steuerfrei ?? 0,
      gewinn: euer.gewinn,
    }).toEqual({ journalZ12: 500, z13: 500, z16: 0, gewinn: 500 });
  });
});
