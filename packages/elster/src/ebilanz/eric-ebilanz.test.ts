import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ericMeldungen } from "../formatprobe.ts";
import { ericHomeIn } from "../install.ts";
import { EricProcessClient } from "../process-client.ts";
import {
  abschluss,
  type AnlagenspiegelZeile,
  EBILANZ_KONTEN,
  ebilanzRestlaufzeiten,
  ebilanzZuordnung,
  postenOf,
  vermerkKonten,
  type Kontenrahmen,
} from "@haben/core";
import { buildEbilanzXml, ebilanzWerte, type EbilanzInput } from "./xbrl.ts";

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

  // Restlaufzeiten (§ 268 Abs. 4 und 5 HGB) als Davon-Positionen, Gesellschafter auf eigenen Positionen (§ 42 Abs. 3 GmbHG)
  it.each([
    [
      "SKR03",
      {
        bank: "1200",
        kapital: "0800",
        ford: "1400",
        fordGes: "1383",
        lulGes: "1490",
        verb: "1600",
        ges: "0730",
        darlehen: "0640",
        ust: "1776",
        erloese: "8400",
      },
    ],
    [
      "SKR04",
      {
        bank: "1800",
        kapital: "2900",
        ford: "1200",
        fordGes: "1309",
        lulGes: "1250",
        verb: "3300",
        ges: "3510",
        darlehen: "3160",
        ust: "3806",
        erloese: "4400",
      },
    ],
  ] as const)(
    "%s: Davon-Vermerke zu Restlaufzeiten und Gesellschafter",
    async (kontenrahmen, k) => {
      const salden = [
        { account: k.bank, saldo: 3_100_000 },
        { account: k.ford, saldo: 500_000 },
        { account: k.erloese, saldo: -100_000 },
        { account: k.fordGes, saldo: 100_000 },
        { account: k.lulGes, saldo: 50_000 },
        { account: k.kapital, saldo: -2_500_000 },
        { account: k.verb, saldo: -150_000 },
        { account: k.ges, saldo: -350_000 },
        { account: k.darlehen, saldo: -600_000 },
        { account: k.ust, saldo: -50_000 },
      ];
      const { zuordnung, fehlend } = ebilanzZuordnung(kontenrahmen, salden);
      expect(fehlend).toEqual([]);
      const konten = vermerkKonten(kontenrahmen, abschluss(kontenrahmen, salden));
      const davon = ebilanzRestlaufzeiten(
        kontenrahmen,
        konten,
        new Map([
          [k.darlehen, 600_000],
          [k.fordGes, 100_000],
          [k.ges, 200_000],
        ]),
      );
      expect(davon["bs.eqLiab.liab.above1year"]).toBe(800_000);
      await pruefe({
        ...basis,
        werte: { ...ebilanzWerte(zuordnung), ...davon },
        bvv: { eigenkapitalVorjahr: 2_500_000, ausschuettungen: 0, einlagen: 0 },
        anlagen: [],
      });
    },
    60_000,
  );

  // Jedes Konto, das Haben bucht, mit einem Saldo auf seiner üblichen Seite; die Bank gleicht aus
  it.each(["SKR03", "SKR04"] as const)(
    "%s: alle Konten der Zuordnung zusammen",
    async (kontenrahmen: Kontenrahmen) => {
      const salden = Object.keys(EBILANZ_KONTEN[kontenrahmen]).map((account, i) => {
        const posten = postenOf(kontenrahmen, account)!;
        const soll = posten.startsWith("aktiva.") || !["passiva.", "umsatzerloese", "sonstigeErtraege"].some((p) => posten.startsWith(p));
        return { account, saldo: (soll ? 1 : -1) * (10_000 + i * 100) };
      });
      const bank = kontenrahmen === "SKR03" ? "1200" : "1800";
      const ohneBank = salden.filter((s) => s.account !== bank);
      const { zuordnung, fehlend } = ebilanzZuordnung(kontenrahmen, [...ohneBank, { account: bank, saldo: -ohneBank.reduce((sum, s) => sum + s.saldo, 0) }]);
      expect(fehlend).toEqual([]);
      const werte = ebilanzWerte(zuordnung);
      const anlagen: AnlagenspiegelZeile[] = Object.entries(werte)
        .filter(([position]) => position.startsWith("bs.ass.fixAss."))
        .map(([position, wert]) => ({ position, akAnfang: wert, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 }));
      const eigenkapital = ["bs.eqLiab.equity.subscribed.corp", "bs.eqLiab.equity.retainedEarnings"].reduce((sum, p) => sum + (werte[p] ?? 0), 0);
      await pruefe({ ...basis, werte, bvv: { eigenkapitalVorjahr: eigenkapital, ausschuettungen: 0, einlagen: 0 }, anlagen });
    },
    60_000,
  );
});
