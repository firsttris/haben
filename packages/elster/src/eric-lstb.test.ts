import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hatJahresPlugin } from "./eric-plugins.ts";
import { ericMeldungen } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { buildLStBStornoXml, buildLStBXml, LSTB_SCHNITTSTELLEN } from "./lstb.ts";
import { LSTB_BASIS, LSTB_STORNO, LSTB_WERTE } from "./lstb.testdaten.ts";
import { EricProcessClient } from "./process-client.ts";
import { parseWorkerCommand } from "./factory.ts";
import { ericTestTimeout } from "../test-fixtures/eric-zeit.ts";

/**
 * Lohnsteuerbescheinigung mit dem echten ERiC prüfen; gesendet wird nichts. ERiC prüft bei ElsterLohn nur den Umschlag
 * (Entwicklerhandbuch Kap. 9.5.1), die Nutzdaten prüft lstb.test.ts gegen das Schema. Ohne ERiC übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/eric-lstb.test.ts
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
const herstellerId = process.env.ELSTER_HERSTELLER_ID || "12345";

describe.skipIf(!ericHome)("Lohnsteuerbescheinigung mit ERiC", () => {
  const client = new EricProcessClient({ ericHome: ericHome!, workerCommand: parseWorkerCommand(process.env.ERIC_WORKER_COMMAND) });
  const pruefe = async (xml: string) => {
    const result = await client.validate(xml);
    expect(ericMeldungen(result.responseXml), result.message).toEqual([]);
    expect(result.code).toBe(0);
  };
  const jahre = Object.keys(LSTB_SCHNITTSTELLEN).map(Number);
  // Das Plugin checkElsterLohn hat kein Jahr; fehlt es, wird übersprungen
  const vorhanden = hatJahresPlugin(ericHome!, "ElsterLohn");
  it.skip.each(vorhanden ? [] : jahre)("%i (Plugin checkElsterLohn fehlt in diesem ERiC)", () => {});
  it.each(vorhanden ? jahre : [])(
    "%i: Neu, Korrektur und Storno",
    async (jahr) => {
      const werte = { ...LSTB_WERTE, jahr, von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
      await pruefe(buildLStBXml({ ...LSTB_BASIS, werte, herstellerId }));
      await pruefe(
        buildLStBXml({
          ...LSTB_BASIS,
          werte,
          herstellerId,
          anweisung: { art: "Korrektur", kmId: "K-2", refKmId: LSTB_BASIS.anweisung.kmId, korrekturGrund: "Einfache Berichtigung" },
        }),
      );
      await pruefe(buildLStBStornoXml({ ...LSTB_STORNO, jahr, herstellerId }));
    },
    ericTestTimeout(60_000),
  );
});
