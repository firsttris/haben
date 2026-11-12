import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Review #585 Runde 2: GmbH bucht die Gewerbesteuerrückstellung als Umbuchung (wie bookSteuerrueckstellungen)
const KONTEN = {
  SKR03: { gewst: "4320", rueckstellung: "0956" },
  SKR04: { gewst: "7610", rueckstellung: "3035" },
} as const;

describe.skipIf(!testDatabaseUrl)("Manuelle Buchungen einer GmbH im EÜR-Abgleich: keine Fehlalarme (Postgres)", () => {
  let sql: postgres.Sql;
  let manual: typeof import("./manual.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    manual = await import("./manual.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  for (const kr of ["SKR03", "SKR04"] as const) {
    it(`Gewerbesteuerrückstellung der GmbH: keine Abweichung (${kr})`, async () => {
      await leeren(sql)`truncate vat_return_submissions, vat_returns, annual_submissions, journal_lines, journal_entries, company cascade`;
      await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, kleinunternehmer, journal_ab)
        values (1, 'Test GmbH', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kr}, 'soll', 'gmbh', false, 2026)`;
      await manual.createManualEntry(
        "test-user",
        {
          kind: "umbuchung",
          date: "2025-12-31",
          description: "Steuerrückstellungen 2025",
          lines: [
            { account: KONTEN[kr].gewst, debit: 5_000, credit: 0 },
            { account: KONTEN[kr].rueckstellung, debit: 0, credit: 5_000 },
          ],
        },
        "2026-03-01",
      );
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2025)).zeilen)).toEqual([]);
    }, 60_000);
  }
});
