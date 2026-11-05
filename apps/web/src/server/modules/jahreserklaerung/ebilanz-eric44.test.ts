import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

// Ein installiertes ERiC wie 44.3, das die Taxonomie 6.9 prüfen kann, 6.10 aber nicht (kein libcheckBilanz_6_10.so)
vi.mock("../elster/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../elster/index.ts")>();
  return { ...original, ericKenntDatenart: (datenartVersion: string) => datenartVersion !== "Bilanz_6.10" };
});

/*
 * E-Bilanz mit einem ERiC ohne Plugin für die Taxonomie des Wirtschaftsjahres: Haben lehnt ab, bevor ERiC mit
 * „Datenartversion unbekannt“ (610001042) scheitert, und sagt, welches ERiC es braucht. Jahre bis 2026 gehen weiter mit 6.9.
 */
describe.skipIf(!testDatabaseUrl)("E-Bilanz mit ERiC ohne Taxonomie 6.10 (Postgres)", () => {
  let sql: postgres.Sql;
  let ebilanz: typeof import("./ebilanz.ts");
  const actor = "test-user";
  const today = "2028-02-10";

  beforeAll(async () => {
    sql = await setupTestDb();
    ebilanz = await import("./ebilanz.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it.each(["SKR03", "SKR04"] as const)("%s: 2027 abgelehnt, 2026 in Taxonomie 6.9", async (kontenrahmen) => {
    await sql`truncate journal_lines, journal_entries, annual_submissions, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kontenrahmen}, 'ist', 'gmbh')`;
    const hinweis =
      "Für 2027 gilt die HGB-Taxonomie 6.10, die das installierte ERiC nicht prüfen kann. Unter Einstellungen › ERiC eine Version ab 45 installieren.";
    const overview = await ebilanz.ebilanzOverview(2027, today);
    expect(overview?.taxonomie).toBe("6.10");
    expect(overview?.issues).toContainEqual({ tone: "fehler", text: hinweis });
    await expect(ebilanz.submitEbilanz(actor, 2027, new EricGeprueftClient(), { kind: "validate", today })).rejects.toThrow(hinweis);

    const vorjahr = await ebilanz.ebilanzOverview(2026, today);
    expect(vorjahr?.taxonomie).toBe("6.9");
    expect(vorjahr?.issues.some((i) => i.text.includes("Taxonomie"))).toBe(false);
  });
});
