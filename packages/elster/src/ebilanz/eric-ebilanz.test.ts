import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ericMeldungen } from "../formatprobe.ts";
import { ericHomeIn } from "../install.ts";
import { EricProcessClient } from "../process-client.ts";
import { buildEbilanzXml, type EbilanzInput } from "./xbrl.ts";

/**
 * E-Bilanz einer Kleinst-GmbH mit dem echten ERiC prüfen (lokal, ERIC_VALIDIERE; es wird nichts gesendet). Läuft nur mit
 * ERiC (ERIC_HOME oder ERIC_DIR), sonst übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/ebilanz/eric-ebilanz.test.ts
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
const herstellerId = process.env.ELSTER_HERSTELLER_ID || "12345";

const basis: Omit<EbilanzInput, "werte" | "bvv" | "anlagen"> = {
  year: 2025,
  steuernummer13: "5192050001265",
  firma: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
  herstellerId,
  produktVersion: "0.3.1",
  test: true,
  erstellt: "2026-03-01",
};
const ERLOESE_19 = "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT";
const SONSTIGE = "is.netIncome.regular.operatingTC.otherCost.miscellaneous";

describe.skipIf(!ericHome)("E-Bilanz mit ERiC (Taxonomie 6.9)", () => {
  const client = new EricProcessClient({ ericHome: ericHome! });
  const pruefe = async (input: EbilanzInput) => {
    const result = await client.validate(buildEbilanzXml(input));
    expect(ericMeldungen(result.responseXml), result.message).toEqual([]);
    expect(result.code).toBe(0);
  };

  it("Gründungsjahr: Stammkapital eingezahlt, Gewinn, ohne Anlagevermögen", async () => {
    await pruefe({
      ...basis,
      werte: {
        "bs.ass.currAss.cashEquiv.bank": 3_200_000,
        "bs.eqLiab.equity.subscribed.corp": 2_500_000,
        "bs.eqLiab.equity.netIncome": 310_000,
        "bs.eqLiab.liab.shareholders.gmbh": 200_000,
        "bs.eqLiab.liab.other.other": 190_000,
        [ERLOESE_19]: 1_000_000,
        [SONSTIGE]: 690_000,
      },
      bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 2_500_000 },
      anlagen: [],
    });
  }, 60_000);

  it("Folgejahr: Pkw mit AfA im Anlagenspiegel, Verlust", async () => {
    await pruefe({
      ...basis,
      werte: {
        "bs.ass.currAss.cashEquiv.bank": 3_200_000,
        "bs.ass.fixAss.tan.otherEquipm.passengerCars": 1_800_000,
        "bs.eqLiab.equity.subscribed.corp": 2_500_000,
        "bs.eqLiab.equity.netIncome": -290_000,
        "bs.eqLiab.liab.shareholders.gmbh": 2_600_000,
        "bs.eqLiab.liab.other.other": 190_000,
        [ERLOESE_19]: 1_000_000,
        [SONSTIGE]: 690_000,
        "is.netIncome.regular.operatingTC.deprAmort.fixAss.tan.other": 600_000,
      },
      bvv: { eigenkapitalVorjahr: 2_500_000, ausschuettungen: 0, einlagen: 0 },
      anlagen: [
        {
          position: "bs.ass.fixAss.tan.otherEquipm.passengerCars",
          akAnfang: 3_600_000,
          zugaenge: 0,
          abgaenge: 0,
          afaAnfang: 1_200_000,
          afaJahr: 600_000,
          afaAbgaenge: 0,
        },
      ],
    });
  }, 60_000);
});
