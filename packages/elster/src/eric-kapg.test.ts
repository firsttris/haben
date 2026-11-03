import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ericMeldungen } from "./formatprobe.ts";
import { buildGewStXml, type GewStXmlInput } from "./gewst.ts";
import { ericHomeIn } from "./install.ts";
import { buildKstXml, type KstXmlInput } from "./kst.ts";
import { EricProcessClient } from "./process-client.ts";

/**
 * Erklärungen einer GmbH (Gewerbesteuer E20, Körperschaftsteuer E30) mit dem echten ERiC prüfen; es wird nichts
 * gesendet. Ohne ERiC (ERIC_HOME oder ERIC_DIR) übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/eric-kapg.test.ts
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
const herstellerId = process.env.ELSTER_HERSTELLER_ID || "12345";

const envelope = (year: number) => ({
  year,
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Nordlicht Software GmbH", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" },
  herstellerId,
  produktVersion: "0.1.0",
  test: true,
});

const gewst = (year: number, over: Partial<GewStXmlInput> = {}): GewStXmlInput => ({
  ...envelope(year),
  rechtsform: "gmbh",
  gegenstand: "Entwicklung von Software",
  betriebsstaette: { plz: "70173", ort: "Stuttgart" },
  gewinn: 5_930_000,
  hinzurechnungen: { zinsen: 0, beweglich: 0, unbeweglich: 0, rechte: 0 },
  rechteBeschraenktStpfl: 0,
  verlustvortrag: 0,
  ...over,
});

const kst = (year: number, over: Partial<KstXmlInput> = {}): KstXmlInput => ({
  ...envelope(year),
  rechtsform: "gmbh",
  sitz: "Stuttgart",
  anteilseigner: [
    {
      name: "Erika Gesellschafter",
      strasse: "Hafenallee 3",
      plzOrt: "70173 Stuttgart",
      idnr: "86095742719",
      beteiligung: 2_500_000,
      anteil: 10_000,
      geaendert: false,
    },
  ],
  jahresergebnis: 5_800_000,
  hinzurechnungen: { kst: 100_000, soli: 0, kapest: 0, gewst: 0, sonstige: 30_000 },
  verlustvortrag: 0,
  verlustruecktrag: 0,
  einlagekonto: 0,
  leistungen: [],
  eigenkapital: 0,
  nennkapital: 0,
  vertraege: [{ art: "Anstellungsvertrag Geschäftsführung", datum: "2024-01-02", partner: "Erika Gesellschafter", verguetung: 6_000_000 }],
  ...over,
});

describe.skipIf(!ericHome)("Erklärungen der GmbH mit ERiC", () => {
  const client = new EricProcessClient({ ericHome: ericHome! });
  const pruefe = async (xml: string) => {
    const result = await client.validate(xml);
    expect(ericMeldungen(result.responseXml), result.message).toEqual([]);
    expect(result.code).toBe(0);
  };

  it.each([2024, 2025])(
    "Gewerbesteuer %i: Gewinn, Hinzurechnungen, Verlustvortrag; UG mit Verlust",
    async (year) => {
      await pruefe(
        buildGewStXml(
          gewst(year, { hinzurechnungen: { zinsen: 15_000_000, beweglich: 1_200_000, unbeweglich: 20_000_000, rechte: 500_000 }, verlustvortrag: 1_000_000 }),
        ),
      );
      await pruefe(buildGewStXml(gewst(year, { rechtsform: "ug", gewinn: -250_000 })));
      await pruefe(buildGewStXml(gewst(year, { gewinn: 0 })));
    },
    60_000,
  );

  it("Körperschaftsteuer 2025: Gewinn, mit Verlustvortrag und Mindestbesteuerung, Verlustjahr, Gründung der UG", async () => {
    await pruefe(buildKstXml(kst(2025)));
    await pruefe(buildKstXml(kst(2025, { verlustvortrag: 1_000_000 })));
    await pruefe(buildKstXml(kst(2025, { jahresergebnis: 300_000_000, verlustvortrag: 500_000_000 })));
    await pruefe(
      buildKstXml(kst(2025, { jahresergebnis: -2_000_000, hinzurechnungen: { kst: 0, soli: 0, kapest: 0, gewst: 0, sonstige: 0 }, verlustvortrag: 500_000 })),
    );
    await pruefe(
      buildKstXml(
        kst(2025, {
          rechtsform: "ug",
          gruendung: "2025-03-15",
          anteilseigner: [
            {
              name: "Erika Gesellschafter",
              strasse: "Hafenallee 3",
              plzOrt: "70173 Stuttgart",
              idnr: "86095742719",
              beteiligung: 100_000,
              anteil: 10_000,
              geaendert: true,
            },
          ],
          vertraege: [],
        }),
      ),
    );
  }, 60_000);

  it("Körperschaftsteuer 2025 mit Ausschüttungen: aus dem ausschüttbaren Gewinn, über ihn hinaus, mehrere bescheinigte", async () => {
    const gewinn = { einlagekonto: 500_000, eigenkapital: 5_000_000, nennkapital: 2_500_000 };
    const leistung = (beschluss: string, brutto: number, ausEinlagekonto: number) => ({
      beschluss,
      abfluss: `${beschluss.slice(0, 8)}${String(Number(beschluss.slice(8)) + 1).padStart(2, "0")}`,
      brutto,
      ausEinlagekonto,
    });
    await pruefe(buildKstXml(kst(2025, { ...gewinn, leistungen: [leistung("2025-06-15", 1_000_000, 0)] })));
    await pruefe(buildKstXml(kst(2025, { ...gewinn, leistungen: [leistung("2025-04-01", 2_200_000, 200_000)] })));
    await pruefe(buildKstXml(kst(2025, { ...gewinn, leistungen: [leistung("2025-03-01", 1_500_000, 0), leistung("2025-09-01", 1_000_000, 500_000)] })));
    await pruefe(buildKstXml(kst(2025, { leistungen: [leistung("2025-06-15", 1_000_000, 0)], eigenkapital: 5_000_000, nennkapital: 2_500_000 })));
  }, 60_000);
});
