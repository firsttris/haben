import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { taxDetails, turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("KU-Warnung mit derselben §-19-Zählgrundlage (Postgres)", () => {
  let sql: postgres.Sql;
  let read: typeof import("./kleinunternehmer.ts");
  let f: Awaited<ReturnType<typeof turnoverFixtures>>;
  beforeAll(async () => {
    sql = await setupTestDb();
    read = await import("./kleinunternehmer.ts");
  }, 30_000);
  beforeEach(async () => {
    f = await turnoverFixtures(sql);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["ist", "SKR03"],
    ["soll", "SKR04"],
  ] as const)("zählt bekannte KU-Zuflüsse, aber keine 14a-/21-/Auslands-/Anlagenumsätze bei %s/%s", async (mode, chart) => {
    f = await turnoverFixtures(sql, mode, chart);
    for (const details of [
      taxDetails({ exemption: { number: "14", letter: "a" } }),
      taxDetails({ exemption: { number: "21" } }),
      taxDetails({ assetDisposal: true }),
    ]) {
      const invoice = await f.invoice(details.exemption ? "steuerfrei" : "kleinunternehmer", 60_000, 0, details);
      await f.allocate(await f.transaction(60_000), invoice, 60_000);
    }
    const foreign = await f.invoice("eu_sonstige", 60_000, 0, taxDetails({ foreignPlace: { country: "AT", noForeignVat: true } }));
    await f.allocate(await f.transaction(60_000), foreign, 60_000);
    const domestic = await f.invoice("kleinunternehmer", 5_000, 0);
    await f.allocate(await f.transaction(5_000), domestic, 5_000);
    expect(await read.vereinnahmterUmsatz("2026-11-05")).toEqual({ netto: 5_000, ungeklaert: false });
  });

  it("beachtet den Stichtag, echte Rückzahlungen und künftige Zuflüsse", async () => {
    const invoice = await f.invoice("kleinunternehmer", 100_000, 0);
    await f.allocate(await f.transaction(30_000, "2026-01-10"), invoice, 30_000);
    await f.allocate(await f.transaction(70_000, "2026-12-15"), invoice, 70_000);
    await f.allocate(await f.transaction(-10_000, "2026-02-01"), invoice, -10_000);
    expect(await read.vereinnahmterUmsatz("2026-01-31")).toEqual({ netto: 30_000, ungeklaert: false });
    expect(await read.vereinnahmterUmsatz("2026-02-01")).toEqual({ netto: 20_000, ungeklaert: false });
    expect(await read.vereinnahmterUmsatz("2026-12-31")).toEqual({ netto: 90_000, ungeklaert: false });
  });

  it("stellt ungeklärte Zahlungen weiterhin als ungeklärt dar", async () => {
    const invoice = await f.invoice("steuerfrei", 10_000, 0);
    await f.allocate(await f.transaction(10_000), invoice, 10_000);
    expect(await read.vereinnahmterUmsatz("2026-12-31")).toEqual({ netto: 0, ungeklaert: true });
  });

  it("beachtet dieselben Ausnahmen im Vorjahr und bei der Gründungsgrenze", async () => {
    const invoice = await f.invoice("steuerfrei", 3_000_000, 0, taxDetails({ exemption: { number: "14", letter: "a" } }));
    await f.allocate(await f.transaction(3_000_000, "2025-12-31"), invoice, 3_000_000);
    await f.cash(2_300_000, "2026-01-10");
    const result = await read.kleinunternehmerStand("2026-02-01", "2026-01-01");
    expect(result).toMatchObject({ aktuell: { netto: 2_300_000, ungeklaert: false }, naheAktuell: true, jahresgrenze: 2_500_000 });
    const continued = await read.kleinunternehmerStand("2026-02-01", "2025-01-01");
    expect(continued).toMatchObject({ vorjahr: { netto: 0, ungeklaert: false }, vorjahresgrenzeUeberschritten: false });
  });
});
