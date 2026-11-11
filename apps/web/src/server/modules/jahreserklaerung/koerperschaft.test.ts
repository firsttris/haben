import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Körperschaft- und Gewerbesteuer einer GmbH aus den Buchungen: Angaben je Jahr, Fortschreibung aus dem Vorjahr,
 * Rückstellungen buchen, danach ist nichts mehr offen und die E-Bilanz kennt jedes Konto.
 */
describe.skipIf(!testDatabaseUrl)("Körperschaft- und Gewerbesteuer (Postgres)", () => {
  let sql: postgres.Sql;
  let kst: typeof import("./koerperschaft.ts");
  let ebilanz: typeof import("./ebilanz.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  const actor = "test-user";
  const today = "2027-02-10";

  beforeAll(async () => {
    sql = await setupTestDb();
    kst = await import("./koerperschaft.ts");
    ebilanz = await import("./ebilanz.ts");
    ledger = await import("../buchhaltung/ledger.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, corporate_tax_inputs, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 'gmbh')`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: globalThis.crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  describe.each([
    ["SKR03", { bank: "1200", erloes: "8400", ust: "1776", bewirtung: "4650", kst: "2200", gewst: "4320", rKst: "0963", rGewst: "0956", soli: "2208" }],
    ["SKR04", { bank: "1800", erloes: "4400", ust: "3806", bewirtung: "6640", kst: "7600", gewst: "7610", rKst: "3040", rGewst: "3035", soli: "7608" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: Steuern berechnen, Rückstellungen buchen, Folgejahr übernimmt die Angaben",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        // Erlöse 60.000 €, Bewirtung 1.000 €, KSt-Vorauszahlung 1.000 €
        await book("2026-03-01", [
          [k.bank, 7_140_000, 0],
          [k.erloes, 0, 6_000_000],
          [k.ust, 0, 1_140_000],
        ]);
        await book("2026-05-01", [
          [k.bewirtung, 100_000, 0],
          [k.bank, 0, 100_000],
        ]);
        await book("2026-06-10", [
          [k.kst, 100_000, 0],
          [k.bank, 0, 100_000],
        ]);

        expect((await kst.kapgSteuernJahr(2026))?.steuern).toBeNull();
        await expect(kst.bookSteuerrueckstellungen(actor, 2026, today)).rejects.toThrow("Hebesatz");
        await expect(kst.saveKapgAngaben(actor, 2026, { hebesatz: 150, verlustvortragKst: 0, verlustvortragGewst: 0 })).rejects.toThrow("mindestens 200");
        await kst.saveKapgAngaben(actor, 2026, { hebesatz: 400, verlustvortragKst: 1_000_000, verlustvortragGewst: 0 });

        const jahr = await kst.kapgSteuernJahr(2026);
        const s = jahr!.steuern!;
        // 60.000 − 1.000 − 1.000 = 58.000 Jahresüberschuss; + 1.000 KSt + 300 Bewirtung = 59.300; − 10.000 Vortrag
        expect(s.jahresergebnis).toBe(5_800_000);
        expect(s.einkommen).toBe(5_930_000);
        expect(s.zvE).toBe(4_930_000);
        expect(s.kst).toBe(739_500);
        expect(s.soli).toBe(40_672);
        expect(s.gewerbeertrag).toBe(5_930_000);
        expect(s.gewst).toBe(830_200);
        expect(s.rueckstellung).toEqual({ kst: 739_500 + 40_672 - 100_000, gewst: 830_200 });

        await kst.bookSteuerrueckstellungen(actor, 2026, today);
        const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
          where e.description = 'Steuerrückstellungen 2026' order by l.account`;
        expect(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)]).sort()).toEqual(
          [
            [k.kst, 639_500, 0],
            [k.soli, 40_672, 0],
            [k.rKst, 0, 680_172],
            [k.gewst, 830_200, 0],
            [k.rGewst, 0, 830_200],
          ].sort(),
        );
        const danach = (await kst.kapgSteuernJahr(2026))!.steuern!;
        expect(danach.rueckstellung).toEqual({ kst: 0, gewst: 0 });
        expect(danach.kst).toBe(s.kst);
        await expect(kst.bookSteuerrueckstellungen(actor, 2026, today)).rejects.toThrow("keine Steuerrückstellung");

        // Die E-Bilanz kennt Steuerkonten und Rückstellungen
        const { issues, daten } = await ebilanz.ebilanzDaten(2026, await stammdaten.loadCompany());
        expect(issues).toEqual([]);
        expect(daten.werte).toMatchObject({ "bs.eqLiab.accruals.tax.kst": 680_172, "bs.eqLiab.accruals.tax.gewst": 830_200 });

        // 2027 ohne eigene Angaben: Hebesatz und Vorträge aus 2026 (Vortrag verbraucht)
        const folgejahr = await kst.kapgSteuernJahr(2027);
        expect(folgejahr).toMatchObject({ gespeichert: false, angaben: { hebesatz: 400, verlustvortragKst: 0, verlustvortragGewst: 0 } });
      },
      30_000,
    );
  });

  it("gleichzeitiges Speichern von Steuerangaben und Angaben zur Erklärung verliert keine", async () => {
    await setup("SKR04", "ist");
    const anteilseigner = { name: "Erika", strasse: "Weg 1", plzOrt: "93047 Regensburg", idnr: "86095742719", beteiligung: 2_500_000, anteil: 10_000 };
    for (const year of [2020, 2021, 2022, 2023, 2024]) {
      await Promise.all([
        kst.saveKapgAngaben(actor, year, { hebesatz: 400, verlustvortragKst: 0, verlustvortragGewst: 0 }),
        kst.saveKapgErklaerungAngaben(actor, year, { anteilseigner: [anteilseigner] }),
      ]);
      const [row] = await sql`select data from corporate_tax_inputs where year = ${year}`;
      expect(row!.data, String(year)).toMatchObject({ hebesatz: 400, erklaerung: { anteilseigner: [expect.objectContaining({ name: "Erika" })] } });
    }
  });

  it("Einzelunternehmen haben keine Körperschaftsteuer", async () => {
    await setup("SKR04", "ist");
    await sql`update company set rechtsform = 'einzelunternehmen'`;
    expect(await kst.kapgSteuernJahr(2026)).toBeNull();
    await expect(kst.bookSteuerrueckstellungen(actor, 2026, today)).rejects.toThrow("nur für GmbH und UG");
  });
});
