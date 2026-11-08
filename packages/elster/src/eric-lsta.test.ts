import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hatJahresPlugin } from "./eric-plugins.ts";
import { ericMeldungen } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { buildLStAXml, LSTA_JAHRE, type LStAInput } from "./lsta.ts";
import { EricProcessClient } from "./process-client.ts";
import { parseWorkerCommand } from "./factory.ts";
import { ericTestTimeout } from "../test-fixtures/eric-zeit.ts";

/**
 * Lohnsteuer-Anmeldung mit dem echten ERiC prüfen; gesendet wird nichts. Ohne ERiC übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/eric-lsta.test.ts
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));

const null3 = { vorjahr: 0, lfdJahr: 0, folgejahr: 0 };
const basis: Omit<LStAInput, "zeitraum"> = {
  steuernummer13: "9198011310134",
  kennzahlen: {
    kz42: { vorjahr: 0, lfdJahr: 1_289_33, folgejahr: 0 },
    kz49: null3,
    kirche: { kz61: { vorjahr: 0, lfdJahr: 103_14, folgejahr: 0 }, kz62: null3, kz63: null3 },
    kz48: 1_289_33,
    kz83: 1_392_47,
    kz86: 1,
  },
  berichtigt: false,
  datenlieferant: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "80331", ort: "München" },
  herstellerId: process.env.ELSTER_HERSTELLER_ID || "12345",
  produktVersion: "0.1.0",
  test: true,
};

describe.skipIf(!ericHome)("Lohnsteuer-Anmeldung mit ERiC", () => {
  const client = new EricProcessClient({ ericHome: ericHome!, workerCommand: parseWorkerCommand(process.env.ERIC_WORKER_COMMAND) });
  /** Hinweise zu einem Zeitraum, der noch nicht vorbei ist (Regeln LStA_Zeitraum_Zukunft, LStA_Zeitraum_nicht_beendet), sind keine Fehler */
  const zukunft = /Zukunft|noch nicht beendet|nicht abgelaufen/i;
  const pruefe = async (input: LStAInput) => {
    const result = await client.validate(buildLStAXml(input));
    expect(
      ericMeldungen(result.responseXml).filter((m) => !zukunft.test(m)),
      result.message,
    ).toEqual([]);
    expect(result.code).toBe(0);
  };

  // LStA_2027 kennt ERiC erst ab 45; fehlt das Plugin, wird das Jahr übersprungen
  const vorhanden = (year: number) => hatJahresPlugin(ericHome!, `LStA_${year}`);
  it.skip.each(LSTA_JAHRE.filter((y) => !vorhanden(y)))("%i (Plugin fehlt in diesem ERiC)", () => {});
  it.each(LSTA_JAHRE.filter(vorhanden))(
    "%i: Monat, Quartal, Kalenderjahr, Berichtigung, Vorjahr, nur Minijob, mehrere Konfessionen",
    async (year) => {
      await pruefe({ ...basis, zeitraum: { year, zeitraum: 1 } });
      await pruefe({ ...basis, zeitraum: { year, zeitraum: 1 }, berichtigt: true });
      // Dezember des Vorjahres mit Zahltag im Januar: Spalte Vorjahr
      await pruefe({
        ...basis,
        zeitraum: { year, zeitraum: 1 },
        kennzahlen: {
          kz42: { vorjahr: 1_289_33, lfdJahr: 1_289_33, folgejahr: 0 },
          kz49: { vorjahr: 10_00, lfdJahr: 10_00, folgejahr: 0 },
          kirche: { kz61: { vorjahr: 103_14, lfdJahr: 103_14, folgejahr: 0 }, kz62: { vorjahr: 0, lfdJahr: 50_00, folgejahr: 0 }, kz63: null3 },
          kz48: 2_578_66,
          kz83: 2_854_94,
          kz86: 2,
        },
      });
      // Nur Minijob mit Pauschsteuer an die Minijob-Zentrale: alles 0, ein Arbeitnehmer
      await pruefe({
        ...basis,
        zeitraum: { year, zeitraum: 1 },
        kennzahlen: { kz42: null3, kz49: null3, kirche: { kz61: null3, kz62: null3, kz63: null3 }, kz48: 0, kz83: 0, kz86: 1 },
      });
      await pruefe({ ...basis, zeitraum: { year, zeitraum: 44 } });
      await pruefe({ ...basis, zeitraum: { year, zeitraum: 19 } });
      await pruefe({ ...basis, zeitraum: { year, zeitraum: 12 } });
    },
    ericTestTimeout(120_000),
  );
});
