import type { EstAngabenInput } from "../jahreserklaerung/income-tax.ts";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Jahresangaben in der Vorauszahlungsprognose (Postgres, #1008)", () => {
  let finanzamt: typeof import("./finanzamt.ts");
  let incomeTax: typeof import("../jahreserklaerung/income-tax.ts");
  let annual: typeof import("../jahreserklaerung/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const angaben: EstAngabenInput = {
    vorsorge: { a: { pkv: 500_000 } },
    arbeitnehmer: { a: { bescheinigungen: [{ steuerklasse: 4, brutto: 6_000_000, lohnsteuer: 100_000 }] } },
  };
  const ersatzleistungen = {
    a: [{ art: "Elterngeld", betrag: 1_000_000 }],
    b: [{ art: "Krankengeld", betrag: 600_000 }],
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    finanzamt = await import("./finanzamt.ts");
    incomeTax = await import("../jahreserklaerung/income-tax.ts");
    annual = await import("../jahreserklaerung/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate company, income_tax_inputs cascade`;
    const taxpayer = {
      veranlagung: "zusammen",
      a: { vorname: "Max", name: "Muster", religion: "11" },
      b: { vorname: "Erika", name: "Muster", religion: "11" },
    };
    await sql`insert into company (id, name, bundesland, versteuerung, kontenrahmen, einkunftsart, taxpayer)
      values (1, 'Testfirma', 'BY', 'ist', 'SKR03', 'selbstaendig', ${JSON.stringify(taxpayer)}::jsonb)`;
  });

  it.each([
    ["Person A", { a: ersatzleistungen.a }],
    ["Person B", { b: ersatzleistungen.b }],
    ["beide Personen", ersatzleistungen],
  ] as const)("übernimmt Ersatzleistungen aus dem Vorjahr nicht für %s", async (_person, leistungen) => {
    await incomeTax.saveEstAngaben(actor, 2025, { ...angaben, ersatzleistungen: leistungen });
    const [vorher] = await sql`select data, updated_at from income_tax_inputs where year = 2025`;
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    // 60.000 € Lohn − 1.230 € Werbungskosten − 5.000 € PKV − 72 € Sonderausgaben = 53.698 €.
    // Splitting 2026 (§ 32a Abs. 1, 5 EStG): 2 × floor((173,10 × 0,905 + 2.397) × 0,905 + 1.034,87) = 6.690 €.
    // Die Übernahme betrifft nur die Prognose für 2026, nicht die Veranlagung 2025 (§ 32b EStG).
    expect(basis.angabenAus).toBe(2025);
    expect(basis.prognose).toMatchObject({
      einkuenfteArbeit: 5_877_000,
      vorsorge: 500_000,
      sonderausgaben: 7_200,
      zvE: 5_369_800,
      einkommensteuer: 669_000,
      steuerabzug: 100_000,
      jeQuartal: 142_300,
    });
    const [nachher] = await sql`select data, updated_at from income_tax_inputs where year = 2025`;
    expect(nachher).toEqual(vorher);
    expect((await incomeTax.loadEstAngaben(2025)).ersatzleistungen).toEqual(leistungen);
  });

  it("berücksichtigt aktuelle Leistungen beider Personen weiter und bevorzugt aktuelle Angaben", async () => {
    await incomeTax.saveEstAngaben(actor, 2025, { vorsorge: { a: { pkv: 900_000 } } });
    await incomeTax.saveEstAngaben(actor, 2026, angaben);
    const ohne = await finanzamt.prepaymentBasis("2026-07-02");
    await incomeTax.saveEstAngaben(actor, 2026, { ...angaben, ersatzleistungen });
    const mit = await finanzamt.prepaymentBasis("2026-07-02");
    expect(mit.angabenAus).toBe(2026);
    expect(mit.prognose.vorsorge).toBe(500_000);
    expect(mit.prognose.zvE).toBe(ohne.prognose.zvE);
    expect(mit.prognose.einkommensteuer).toBeGreaterThan(ohne.prognose.einkommensteuer);
    const erklaerung = await annual.annualOverview(2026, "2027-07-02");
    expect(erklaerung.est.prognose).toEqual(mit.prognose);
    // Auch jede Person allein erhöht den Satz: der Test würde ein versehentliches Weglassen von B bemerken.
    for (const leistungen of [{ a: ersatzleistungen.a }, { b: ersatzleistungen.b }]) {
      await incomeTax.saveEstAngaben(actor, 2026, { ...angaben, ersatzleistungen: leistungen });
      expect((await finanzamt.prepaymentBasis("2026-07-02")).prognose.einkommensteuer).toBeGreaterThan(ohne.prognose.einkommensteuer);
    }
  });

  it("erhält den Progressionsvorbehalt der Jahreserklärung nach einer Vorjahresübernahme", async () => {
    await incomeTax.saveEstAngaben(actor, 2025, angaben);
    const ohne = await annual.annualOverview(2025, "2026-07-02");
    await incomeTax.saveEstAngaben(actor, 2025, { ...angaben, ersatzleistungen });
    await finanzamt.prepaymentBasis("2026-07-02");
    const mit = await annual.annualOverview(2025, "2026-07-02");
    expect(mit.est.angaben.ersatzleistungen).toEqual(ersatzleistungen);
    expect(mit.est.prognose.zvE).toBe(ohne.est.prognose.zvE);
    expect(mit.est.prognose.einkommensteuer).toBeGreaterThan(ohne.est.prognose.einkommensteuer);
  });

  it("rechnet ohne Angaben und mit leeren oder fehlenden Vorjahresleistungen", async () => {
    expect((await finanzamt.prepaymentBasis("2026-07-02")).angabenAus).toBeNull();
    for (const leistungen of [undefined, {}, { a: [], b: [] }, { a: [{ art: "Elterngeld", betrag: 0 }] }]) {
      await incomeTax.saveEstAngaben(actor, 2025, { ...angaben, ersatzleistungen: leistungen });
      expect((await finanzamt.prepaymentBasis("2026-07-02")).prognose.einkommensteuer).toBe(669_000);
    }
  });
});
