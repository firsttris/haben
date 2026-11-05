import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ericMeldungen } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { buildKapEStAXml, KAPESTA_JAHRE, type KapEStAInput } from "./kapesta.ts";
import { EricProcessClient } from "./process-client.ts";

/**
 * Kapitalertragsteuer-Anmeldung einer GmbH mit dem echten ERiC prüfen; gesendet wird nichts. Ohne ERiC übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/eric-kapesta.test.ts
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));

const basis: KapEStAInput = {
  steuernummer13: "2893081508152",
  bundesland: "BW",
  schuldner: { name: "Nordlicht Software GmbH", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart", telefon: "0711 123456", email: "info@example.com" },
  ertrag: 1_000_000,
  kapest: 250_000,
  soli: 13_750,
  kirchensteuer: [],
  beschluss: { datum: "2026-06-15", betrag: 1_000_000, auszahlungstag: "2026-06-30" },
  herstellerId: process.env.ELSTER_HERSTELLER_ID || "12345",
  produktVersion: "0.1.0",
  test: true,
};

describe.skipIf(!ericHome)("Kapitalertragsteuer-Anmeldung mit ERiC", () => {
  const client = new EricProcessClient({ ericHome: ericHome! });
  const pruefe = async (input: KapEStAInput) => {
    const result = await client.validate(buildKapEStAXml(input));
    expect(ericMeldungen(result.responseXml), result.message).toEqual([]);
    expect(result.code).toBe(0);
  };

  it.each(KAPESTA_JAHRE)(
    "%i: ohne und mit Kirchensteuer",
    async (year) => {
      const z = (iso: string) => iso.replace("2026", String(year));
      await pruefe({ ...basis, beschluss: { datum: z("2026-06-15"), betrag: 1_000_000, auszahlungstag: z("2026-06-30") } });
      // Zwei Gesellschafter, einer kirchensteuerpflichtig (9 %, Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal)
      await pruefe({
        ...basis,
        ertrag: 1_000_000,
        kapest: 122_249 + 125_000,
        soli: 6_723 + 6_875,
        kirchensteuer: [{ religionsschluessel: "010100", betrag: 11_002 }],
        beschluss: { datum: z("2026-06-15"), betrag: 1_000_000 },
      });
    },
    60_000,
  );
});
