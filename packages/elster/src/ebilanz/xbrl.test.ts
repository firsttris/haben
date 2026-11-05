import { describe, expect, it } from "vitest";
import { buildEbilanzXml, datenlieferant, EbilanzError, ebilanzSummen } from "./xbrl.ts";

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
        bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 0 },
        anlagen: [],
        herstellerId: "12345",
        produktVersion: "0.0.0",
        test: true,
        erstellt: "2026-03-01",
      }),
    ).toThrow("Aktiva");
  });

  const gmbh = {
    year: 2025,
    steuernummer13: "5192050001265",
    firma: { name: "Test GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
    herstellerId: "12345",
    produktVersion: "0.0.0",
    test: true,
    erstellt: "2026-03-01",
    werte: {
      "bs.ass.currAss.cashEquiv.bank": 100_000,
      "bs.eqLiab.equity.subscribed.corp": 100_000,
    },
  };

  it("lehnt einen Betriebsvermögensvergleich ab, der nicht das Jahresergebnis ergibt", () => {
    expect(() => buildEbilanzXml({ ...gmbh, bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 0 }, anlagen: [] })).toThrow(
      "Betriebsvermögensvergleich",
    );
    expect(buildEbilanzXml({ ...gmbh, bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 100_000 }, anlagen: [] })).toContain(
      "<DatenArt>Bilanz</DatenArt>",
    );
  });

  it("lässt für die GmbH rechtsformfremde Stammdaten weg, auch leer (ERiC ab 43.5, Fehler 170185126)", () => {
    const xml = buildEbilanzXml({ ...gmbh, bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 100_000 }, anlagen: [] });
    for (const position of [
      "report.id.reportElement.reportElements.KKE",
      "report.id.reportElement.reportElements.SGE",
      "report.id.reportElement.reportElements.SGEP",
      "report.id.statementType.tax",
      "company.id.optionKStGs1a",
      "company.id.shareholder.group",
      "company.id.shareholder.currentnumber",
      "company.id.shareholder.SpecialBalanceRequired",
      "company.id.shareholder.extensionRequired",
    ]) {
      expect(xml).not.toContain(`<de-gcd:genInfo.${position}`);
    }
    // Der Gesellschafter selbst bleibt als Mussfeld, leer
    expect(xml).toContain('<de-gcd:genInfo.company.id.shareholder.name contextRef="D-AKTJAHR" xsi:nil="true"/>');
  });

  it("lehnt einen Anlagenspiegel ab, dessen Buchwert nicht zur Bilanz passt", () => {
    expect(() =>
      buildEbilanzXml({
        ...gmbh,
        bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 100_000 },
        anlagen: [
          { position: "bs.ass.fixAss.tan.otherEquipm.passengerCars", akAnfang: 1_000, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 },
        ],
      }),
    ).toThrow("Anlagenspiegel");
  });

  it("Absender im Format des Übertragungsprotokolls", () => {
    expect(datenlieferant({ name: "Nordlicht; GmbH", strasse: "Hafenallee 3a", plz: "28217", ort: "Bremen", email: "a@b.de" })).toBe(
      "Nordlicht, GmbH; Hafenallee; 3; a; ; 28217; Bremen; Deutschland; ; a@b.de",
    );
  });
});
