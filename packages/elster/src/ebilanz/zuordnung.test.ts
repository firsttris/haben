import { EBILANZ_AUFFANG, EBILANZ_KONTEN, ebilanzZuordnung, postenForSaldo, type Kontenrahmen, type Posten } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildEbilanzXml, ebilanzSummenkette, ebilanzWerte, istEbilanzBlatt } from "./xbrl.ts";

/*
 * Die Kontenzuordnung der E-Bilanz (@haben/core, ebilanz.ts) gegen den Taxonomie-Auszug: jede Position ist ein Blatt der
 * Rechenregeln, summiert sich bis Bilanz oder GuV und liegt unter dem Teil der Taxonomie, der dem Kleinst-Posten des
 * DATEV-Kontenrahmens entspricht. So weichen E-Bilanz und Jahresabschluss nicht voneinander ab.
 */

/** Teilbäume der Taxonomie je Posten nach § 266 und § 275 Abs. 5 HGB */
const TEILBAUM: Record<Posten, readonly string[]> = {
  "aktiva.A": ["bs.ass.fixAss"],
  "aktiva.B": ["bs.ass.currAss"],
  "aktiva.C": ["bs.ass.prepaidExp"],
  "aktiva.D": ["bs.ass.defTax"],
  "aktiva.E": ["bs.ass.surplusFromOffsetting"],
  "passiva.A": ["bs.eqLiab.equity"],
  "passiva.B": ["bs.eqLiab.accruals"],
  "passiva.C": ["bs.eqLiab.liab"],
  "passiva.D": ["bs.eqLiab.defIncome"],
  "passiva.E": ["bs.eqLiab.defTax"],
  umsatzerloese: ["is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales"],
  // Kleinst-GuV: Finanzerträge gehören zu den sonstigen Erträgen, Finanzaufwand zu den sonstigen Aufwendungen
  sonstigeErtraege: ["is.netIncome.regular.operatingTC.otherOpRevenue", "is.netIncome.regular.fin.netInterest.income"],
  materialaufwand: ["is.netIncome.regular.operatingTC.grossTradingProfit.materialServices"],
  personalaufwand: ["is.netIncome.regular.operatingTC.staff"],
  abschreibungen: ["is.netIncome.regular.operatingTC.deprAmort"],
  sonstigeAufwendungen: ["is.netIncome.regular.operatingTC.otherCost", "is.netIncome.regular.fin.netInterest.expenses"],
  steuern: ["is.netIncome.tax", "is.netIncome.otherTaxes"],
};

const unter = (position: string, posten: Posten) => TEILBAUM[posten].some((t) => position === t || position.startsWith(`${t}.`));
const wurzel = (position: string) => ebilanzSummenkette(position).at(-1);

describe.each(["SKR03", "SKR04"] as const)("E-Bilanz-Zuordnung %s", (kontenrahmen: Kontenrahmen) => {
  const konten = Object.entries(EBILANZ_KONTEN[kontenrahmen]);

  it.each(konten)("Konto %s: Blatt, summiert bis zur Wurzel, im Teilbaum seines Postens", (account, ziel) => {
    for (const [i, position] of ziel.entries()) {
      if (!position) continue;
      expect(istEbilanzBlatt(position), position).toBe(true);
      expect(["bs.ass", "bs.eqLiab", "is.netIncome"], position).toContain(wurzel(position));
      // Erste Position für den Soll-Saldo, zweite für den Haben-Saldo; ohne zweite bleibt der Posten beider gleich
      const saldo = i === 0 ? 100 : -100;
      const posten = postenForSaldo(kontenrahmen, account, ziel[1] ? saldo : 100);
      expect(posten, account).not.toBeNull();
      expect(unter(position, posten!), `${account} ${posten} → ${position}`).toBe(true);
    }
  });

  it("Auffangpositionen sind Blätter im Teilbaum ihres Postens", () => {
    for (const [posten, position] of Object.entries(EBILANZ_AUFFANG) as [Posten, string | null][]) {
      if (!position) continue;
      expect(istEbilanzBlatt(position), position).toBe(true);
      expect(unter(position, posten), `${posten} → ${position}`).toBe(true);
      expect(["bs.ass", "bs.eqLiab", "is.netIncome"]).toContain(wurzel(position));
    }
  });
});

describe("Werte aus Salden", () => {
  it("SKR04 Ist: Gründungsjahr ergibt eine gültige, ausgeglichene E-Bilanz", () => {
    // Stammkapital 25.000, Erlöse 10.000 + 1.900 USt, Software 3.000 vom Gesellschafter ausgelegt, unbekanntes Konto 1500
    const { zuordnung, fehlend } = ebilanzZuordnung("SKR04", [
      { account: "1800", saldo: 3_690_000 },
      { account: "2900", saldo: -2_500_000 },
      { account: "4400", saldo: -1_000_000 },
      { account: "3806", saldo: -190_000 },
      { account: "6837", saldo: 300_000 },
      { account: "3510", saldo: -300_000 },
      { account: "1500", saldo: 0 },
      { account: "9000", saldo: 0 },
    ]);
    expect(fehlend).toEqual([]);
    const werte = ebilanzWerte(zuordnung);
    expect(werte).toEqual({
      "bs.ass.currAss.cashEquiv.bank": 3_690_000,
      "bs.eqLiab.equity.subscribed.corp": 2_500_000,
      "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT": 1_000_000,
      "bs.eqLiab.liab.other.theroffTax.vat": 190_000,
      "is.netIncome.regular.operatingTC.otherCost.concessLicenses.nonallocable": 300_000,
      "bs.eqLiab.liab.shareholders.gmbh": 300_000,
      "bs.eqLiab.equity.netIncome": 700_000,
    });
    expect(() =>
      buildEbilanzXml({
        year: 2026,
        steuernummer13: "5192050001265",
        firma: { name: "Nordlicht GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
        werte,
        bvv: { eigenkapitalVorjahr: 0, ausschuettungen: 0, einlagen: 2_500_000 },
        anlagen: [],
        herstellerId: "12345",
        produktVersion: "0.1",
        test: true,
        erstellt: "2027-03-01",
      }),
    ).not.toThrow();
  });

  it.each([
    ["SKR03", "1200", "0730", "1576"],
    ["SKR04", "1800", "3510", "1406"],
  ] as const)("%s: Bank im Haben, Gesellschafter im Soll, Vorsteuerüberhang", (kontenrahmen, bank, gesellschafter, vorsteuer) => {
    const { zuordnung } = ebilanzZuordnung(kontenrahmen, [
      { account: bank, saldo: -50_000 },
      { account: gesellschafter, saldo: 30_000 },
      { account: vorsteuer, saldo: 20_000 },
    ]);
    expect(ebilanzWerte(zuordnung)).toEqual({
      "bs.eqLiab.liab.bank.other": 50_000,
      "bs.ass.currAss.receiv.other.shareholders": 30_000,
      "bs.ass.currAss.receiv.other.vat": 20_000,
    });
  });

  it("Konten ohne Position und offene Saldenvorträge fehlen", () => {
    // 0010 Konzessionen (Anlagevermögen ohne Anlagenspiegel), 2200 nicht vorhanden in SKR04, 9000 offen
    const { fehlend } = ebilanzZuordnung("SKR04", [
      { account: "0010", saldo: 100 },
      { account: "9000", saldo: -100 },
    ]);
    expect(fehlend.map((f) => f.account)).toEqual(["0010", "9000"]);
  });
});
