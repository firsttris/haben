import { ebilanzPosition, ebilanzZuordnung } from "@haben/core";
import { describe, expect, it } from "vitest";
import { ebilanzPositionen, ebilanzSummen, ebilanzSummenkette, istEbilanzBlatt } from "./taxonomie.ts";
import { ebilanzKontensalden, ebilanzWerte } from "./xbrl.ts";

/**
 * #750: Erhaltene Anzahlungen auf den bestätigten generischen Konten 1710/3250, Umsatzsteuer separat.
 * https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 * DATEV SKR03/04 2026 ordnet diese Konten den erhaltenen Anzahlungen auf Bestellungen zu, ohne AM-Funktion.
 * https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11174%20SKR03%20BilrUg.pdf
 * https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11175%20SKR04%20BilrUg.pdf
 * Amtliche Originale: de-gaap-ci-2025-04-01.xsd / de-gaap-ci-2026-04-01.xsd und Calculation-Linkbases.
 * https://www.esteuer.de/download/taxonomie_20250618/german-gaap-taxonomy-v6.9-2025-04-01-xbrl.zip
 * https://www.esteuer.de/download/taxonomie_20260615/germany-gaap-taxonomy-v6.10-2026-04-01-xbrl.zip
 */
const ADVANCE = "bs.eqLiab.liab.advPaym";
const BANK = "bs.ass.currAss.cashEquiv.bank";
const VAT = "bs.eqLiab.liab.other.theroffTax.vat";

describe("Erhaltene Anzahlungen im gesonderten E-Bilanz-Posten", () => {
  it.each([
    ["SKR03", "1710"],
    ["SKR04", "3250"],
  ] as const)("%s Konto %s: Habenbestand steht unter erhaltenen Anzahlungen", (frame, account) => {
    expect(ebilanzPosition(frame, account, -30_000)).toBe(ADVANCE);
  });
});

describe.each(["6.9", "6.10"] as const)("Anzahlungsbestand in Taxonomie %s", (version) => {
  it("verwendet den Hauptposten mit Rechenverknüpfung, nicht den freiwilligen Davon-Posten", () => {
    expect(ebilanzPositionen(version)[ADVANCE]).toEqual(["M", "bs.eqLiab.liab", 1, "credit", "instant"]);
    expect(istEbilanzBlatt(ADVANCE, version)).toBe(true);
    expect(ebilanzSummenkette(ADVANCE, version)).toEqual([ADVANCE, "bs.eqLiab.liab", "bs.eqLiab"]);
  });

  it.each([
    ["SKR03", "1200", "1710", "1776", 30_000, 5_700],
    ["SKR04", "1800", "3250", "3806", 10_000, 1_900],
  ] as const)("%s: vorgegebene Bank-, Anzahlungs- und Steuersalden wirken ohne Erlös genau einmal", (frame, bank, advance, vat, net, tax) => {
    const gross = net + tax;
    const { zuordnung, fehlend } = ebilanzZuordnung(frame, [
      { account: bank, saldo: gross },
      { account: advance, saldo: -net },
      { account: vat, saldo: -tax },
    ]);
    expect(fehlend).toEqual([]);
    const values = ebilanzWerte(zuordnung, version);
    expect(values).toEqual({ [BANK]: gross, [ADVANCE]: net, [VAT]: tax });
    expect(Object.keys(values).filter((key) => key.startsWith("is.") || key === "bs.eqLiab.equity.netIncome")).toEqual([]);
    const sums = ebilanzSummen(values, version);
    expect(sums.get("bs.ass")).toBe(gross);
    expect(sums.get("bs.eqLiab")).toBe(gross);
    expect(ebilanzKontensalden(zuordnung, () => "Testkonto", version)).toContainEqual({
      account: advance,
      name: "Testkonto",
      position: ADVANCE,
      betrag: net,
    });
  });
});
