import { describe, expect, it } from "vitest";
import { datenartVersionFromXml } from "../xml.ts";
import { kontennachweis, nachweisPositionen } from "./kontennachweis.ts";
import { ebilanzSummen, ebilanzTaxonomie, istRechnerischVerknuepft } from "./taxonomie.ts";
import { buildEbilanzXml, ebilanzKontensalden, ebilanzWerte, type EbilanzInput } from "./xbrl.ts";

/*
 * Kontennachweis nach Tz. B.12 der Technischen Leitfäden 6.9 und 6.10 und Auswahl der Taxonomie nach dem Wirtschaftsjahr
 * (BMF-Schreiben vom 8. Juni 2026).
 */

const BANK = "bs.ass.currAss.cashEquiv.bank";
const KAPITAL = "bs.eqLiab.equity.subscribed.corp";
const ERGEBNIS = "bs.eqLiab.equity.netIncome";
const ERLOESE = "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT";
const SONSTIGE = "is.netIncome.regular.operatingTC.otherCost.miscellaneous";

// Gründungsjahr einer GmbH (SKR04): zwei Bankkonten, Stammkapital, Erlöse, sonstige Kosten, Gewinn 3.100 €
const zuordnung = [
  { account: "1800", saldo: 2_000_000, position: BANK },
  { account: "1810", saldo: 810_000, position: BANK },
  { account: "2900", saldo: -2_500_000, position: KAPITAL },
  { account: "4400", saldo: -1_000_000, position: ERLOESE },
  { account: "6300", saldo: 690_000, position: SONSTIGE },
];
const namen: Record<string, string> = {
  "1800": "Bank",
  "1810": "Bank 2",
  "2900": "Gezeichnetes Kapital",
  "4400": "Erlöse 19 % USt",
  "6300": "Sonstige Aufwendungen",
};

const input = (year: number, z = zuordnung): EbilanzInput => {
  const taxonomie = ebilanzTaxonomie(year);
  return {
    year,
    taxonomie,
    steuernummer13: "5192050001265",
    firma: { name: "Nordlicht GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
    werte: ebilanzWerte(z, taxonomie),
    konten: ebilanzKontensalden(z, (a) => namen[a] ?? "", taxonomie),
    bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 2_500_000 },
    anlagen: [],
    herstellerId: "12345",
    produktVersion: "0.1",
    test: true,
    erstellt: `${year + 1}-03-01`,
  };
};

describe("Taxonomie nach dem Wirtschaftsjahr (BMF-Schreiben vom 8. Juni 2026)", () => {
  it("6.9 bis 2026, 6.10 für Wirtschaftsjahre, die nach dem 31. Dezember 2026 beginnen", () => {
    expect(ebilanzTaxonomie(2025)).toBe("6.9");
    expect(ebilanzTaxonomie(2026)).toBe("6.9");
    expect(ebilanzTaxonomie(2027)).toBe("6.10");
    expect(ebilanzTaxonomie(2030)).toBe("6.10");
  });

  it("Namensraum und Datenart-Version für ERiC", () => {
    expect(datenartVersionFromXml(buildEbilanzXml(input(2026)))).toBe("Bilanz_6.9");
    const xml = buildEbilanzXml(input(2027));
    expect(datenartVersionFromXml(xml)).toBe("Bilanz_6.10");
    expect(xml).toContain('xlink:href="http://www.xbrl.de/taxonomies/de-gcd-2026-04-01/de-gcd-2026-04-01-shell.xsd"');
    expect(xml).toContain('xlink:href="http://www.xbrl.de/taxonomies/de-gaap-ci-2026-04-01/de-gaap-ci-2026-04-01-shell-fiscal.xsd"');
    expect(xml).not.toContain("2025-04-01");
  });
});

describe("Kontennachweis (Technischer Leitfaden 6.10, Tz. B.12.1)", () => {
  it("braucht ihn zu jeder werthaltigen, rechnerisch verknüpften Position ohne werthaltige Unterposition", () => {
    const { werte } = input(2027);
    const summen = ebilanzSummen(werte, "6.10");
    expect(nachweisPositionen(summen, "6.10")).toEqual([BANK, ERGEBNIS, KAPITAL, ERLOESE, SONSTIGE].sort((a, b) => a.localeCompare(b)));
  });

  it("nicht zu rechnerisch nicht verknüpften Davon-Vermerken", () => {
    expect(istRechnerischVerknuepft("bs.eqLiab.liab.above1year", "6.10")).toBe(false);
    expect(istRechnerischVerknuepft("bs.eqLiab.liab.shareholders.upTo1year", "6.10")).toBe(false);
    expect(istRechnerischVerknuepft("bs.ass", "6.10")).toBe(true);
    const summen = ebilanzSummen({ "bs.eqLiab.liab.shareholders.gmbh": 300_000, "bs.eqLiab.liab.shareholders.upTo1year": 300_000 }, "6.10");
    expect(nachweisPositionen(summen, "6.10")).toEqual(["bs.eqLiab.liab.shareholders.gmbh"]);
  });

  it("unverdichtet je Konto, Saldo im Vorzeichen der Position; Jahresüberschuss ohne Konto", () => {
    const { werte, konten } = input(2027);
    const eintraege = kontennachweis(ebilanzSummen(werte, "6.10"), konten, "6.10");
    expect(eintraege).toEqual([
      { position: BANK, betrag: 2_000_000, konto: { nummer: "1800", name: "Bank" } },
      { position: BANK, betrag: 810_000, konto: { nummer: "1810", name: "Bank 2" } },
      { position: ERGEBNIS, betrag: 310_000 },
      { position: KAPITAL, betrag: 2_500_000, konto: { nummer: "2900", name: "Gezeichnetes Kapital" } },
      { position: ERLOESE, betrag: 1_000_000, konto: { nummer: "4400", name: "Erlöse 19 % USt" } },
      { position: SONSTIGE, betrag: 690_000, konto: { nummer: "6300", name: "Sonstige Aufwendungen" } },
    ]);
  });

  it("6.10: Tupel mit Konto oder mit „Konto nicht vorhanden“, ohne Begründung NoKS", () => {
    const xml = buildEbilanzXml(input(2027));
    expect(xml).toContain('<de-gcd:genInfo.report.id.reportElement.reportElements.KS contextRef="D-AKTJAHR"/>');
    expect(xml).not.toContain("transmissionNotYetPossible");
    expect(xml.match(/<de-gaap-ci:detailedInformation\.accountBalances>/g)).toHaveLength(6);
    expect(xml).toContain(
      [
        "<de-gaap-ci:detailedInformation.accountBalances>",
        `<de-gaap-ci:detailedInformation.accountbalances.positionName contextRef="D-AKTJAHR">de-gaap-ci:${BANK}</de-gaap-ci:detailedInformation.accountbalances.positionName>`,
        '<de-gaap-ci:detailedInformation.accountbalances.accountNumber contextRef="D-AKTJAHR">1810</de-gaap-ci:detailedInformation.accountbalances.accountNumber>',
        '<de-gaap-ci:detailedInformation.accountbalances.accountDescription contextRef="D-AKTJAHR">Bank 2</de-gaap-ci:detailedInformation.accountbalances.accountDescription>',
        '<de-gaap-ci:detailedInformation.accountbalances.amount contextRef="D-AKTJAHR" unitRef="EUR" decimals="2">8100.00</de-gaap-ci:detailedInformation.accountbalances.amount>',
        '<de-gaap-ci:detailedInformation.accountbalances.notPossible xsi:nil="true" contextRef="D-AKTJAHR"/>',
        "</de-gaap-ci:detailedInformation.accountBalances>",
      ].join(""),
    );
    expect(xml).toContain(
      [
        `<de-gaap-ci:detailedInformation.accountbalances.positionName contextRef="D-AKTJAHR">de-gaap-ci:${ERGEBNIS}</de-gaap-ci:detailedInformation.accountbalances.positionName>`,
        '<de-gaap-ci:detailedInformation.accountbalances.accountNumber xsi:nil="true" contextRef="D-AKTJAHR"/>',
        '<de-gaap-ci:detailedInformation.accountbalances.accountDescription xsi:nil="true" contextRef="D-AKTJAHR"/>',
        '<de-gaap-ci:detailedInformation.accountbalances.amount contextRef="D-AKTJAHR" unitRef="EUR" decimals="2">3100.00</de-gaap-ci:detailedInformation.accountbalances.amount>',
        '<de-gaap-ci:detailedInformation.accountbalances.notPossible contextRef="D-AKTJAHR">true</de-gaap-ci:detailedInformation.accountbalances.notPossible>',
      ].join(""),
    );
  });

  it("6.10: Gesellschafter einer GmbH ohne Angaben und ohne „noch nicht vergeben“ (Tz. B.14.3.1.19 gilt Personengesellschaften)", () => {
    const xml = buildEbilanzXml(input(2027));
    expect(xml).toContain('<de-gcd:genInfo.company.id.shareholder.name contextRef="D-AKTJAHR" xsi:nil="true"/>');
    expect(xml).toContain('<de-gcd:genInfo.company.id.shareholder.taxnumber contextRef="D-AKTJAHR" xsi:nil="true"/>');
    expect(xml).not.toContain("idNotAssigned");
  });

  it("6.9: Kontennachweis mit Konten statt NoKS, ohne Eintrag ohne Konto (den kennt 6.9 nicht)", () => {
    const xml = buildEbilanzXml(input(2026));
    expect(xml).toContain('<de-gcd:genInfo.report.id.reportElement.reportElements.KS contextRef="D-AKTJAHR"/>');
    // Die Begründung ist in 6.9 Mussfeld, mit Kontennachweis leer
    expect(xml).toContain('<de-gcd:genInfo.report.id.reportElement.reportElements.transmissionNotYetPossible contextRef="D-AKTJAHR" xsi:nil="true"/>');
    expect(xml).not.toContain("notPossible");
    expect(xml.match(/<de-gaap-ci:detailedInformation\.accountBalances>/g)).toHaveLength(5);
    expect(xml).not.toContain(`de-gaap-ci:${ERGEBNIS}</de-gaap-ci:detailedInformation.accountbalances.positionName>`);
  });

  it("6.9 ohne Konto in der GuV: weiter die Begründung NoKS statt eines unvollständigen Nachweises", () => {
    const nurBilanz = [
      { account: "1800", saldo: 2_500_000, position: BANK },
      { account: "2900", saldo: -2_500_000, position: KAPITAL },
    ];
    const xml = buildEbilanzXml(input(2026, nurBilanz));
    expect(xml).toContain('<de-gcd:genInfo.report.id.reportElement.reportElements.KS contextRef="D-AKTJAHR" xsi:nil="true"/>');
    expect(xml).toContain(">NoKS</de-gcd:genInfo.report.id.reportElement.reportElements.transmissionNotYetPossible>");
    expect(xml).not.toContain("detailedInformation.accountBalances");
    // 6.10 braucht keinen Nachweis für eine leere GuV, aber für die Bilanz
    expect(buildEbilanzXml(input(2027, nurBilanz)).match(/<de-gaap-ci:detailedInformation\.accountBalances>/g)).toHaveLength(2);
  });

  it("Kontobezeichnung fehlt: die Kontonummer steht dafür, weil die Bezeichnung nicht leer sein darf", () => {
    const { werte, konten } = input(2027);
    const ohneNamen = konten.map((k) => ({ ...k, name: " " }));
    expect(kontennachweis(ebilanzSummen(werte, "6.10"), ohneNamen, "6.10")[0]).toMatchObject({ konto: { nummer: "1800", name: "Konto 1800" } });
  });
});
