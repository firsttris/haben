import { describe, expect, it } from "vitest";
import { buildEbilanzXml, EbilanzError, ebilanzSummen, splitStrasse } from "./xbrl.ts";

describe("E-Bilanz: Summen nach den Rechenregeln der Taxonomie 6.9", () => {
  it("gibt Werte mit Gewicht an die Summen weiter, bis Bilanzsumme und Jahresergebnis", () => {
    const summen = ebilanzSummen({
      "bs.ass.currAss.cashEquiv.bank": 3_200_000,
      "bs.eqLiab.equity.subscribed.corp": 2_500_000,
      "bs.eqLiab.equity.netIncome": 310_000,
      "bs.eqLiab.liab.shareholders.gmbh": 200_000,
      "bs.eqLiab.liab.other.other": 190_000,
      "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT": 1_000_000,
      "is.netIncome.regular.operatingTC.otherCost.miscellaneous": 690_000,
    });
    expect(summen.get("bs.ass.currAss.cashEquiv")).toBe(3_200_000);
    expect(summen.get("bs.ass")).toBe(3_200_000);
    expect(summen.get("bs.eqLiab")).toBe(3_200_000);
    expect(summen.get("bs.eqLiab.equity")).toBe(2_810_000);
    // GuV: Aufwand mit Gewicht −1
    expect(summen.get("is.netIncome")).toBe(310_000);
  });

  it("lehnt Positionen ab, die es in der Taxonomie nicht gibt", () => {
    expect(() => ebilanzSummen({ "bs.ass.gibtEsNicht": 1 })).toThrow(EbilanzError);
  });

  it("lehnt eine Bilanz ab, deren Seiten nicht gleich sind", () => {
    expect(() =>
      buildEbilanzXml({
        year: 2025,
        steuernummer13: "5192050001265",
        firma: { name: "Test GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
        werte: { "bs.ass.currAss.cashEquiv.bank": 100 },
        herstellerId: "12345",
        produktVersion: "0.0.0",
        test: true,
        erstellt: "2026-03-01",
      }),
    ).toThrow("Aktiva");
  });

  it.each([
    ["Musterstraße 12", "Musterstraße", "12"],
    ["Hafenallee 3a", "Hafenallee", "3a"],
    ["Am Markt 5 - 7", "Am Markt", "5-7"],
    ["Postfach", "Postfach", ""],
  ])("trennt %s in Straße und Hausnummer", (strasse, street, houseNo) => {
    expect(splitStrasse(strasse)).toEqual({ street, houseNo });
  });
});
