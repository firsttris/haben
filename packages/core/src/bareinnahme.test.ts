import { describe, expect, it } from "vitest";
import { bareinnahmeAnteil, bareinnahmeFehler, bareinnahmePosting, bareinnahmeText, bareinnahmeTotals } from "./bareinnahme.ts";

describe("Bareinnahme ohne Rechnung (#276)", () => {
  it.each([
    ["SKR03", { kasse: "1000", erloese19: "8400", ust19: "1776", erloese7: "8300", ust7: "1771", ku: "8192", frei: "8100" }],
    ["SKR04", { kasse: "1600", erloese19: "4400", ust19: "3806", erloese7: "4300", ust7: "3801", ku: "4184", frei: "4100" }],
  ] as const)("%s: Kasse an Erlöse und fällige Umsatzsteuer, Kleinunternehmer und steuerfrei ohne Steuer", (kr, k) => {
    expect(bareinnahmePosting({ behandlung: "regulaer", steuersatz: 1900 }, 342_50, kr)).toEqual([
      { account: k.kasse, debit: 342_50, credit: 0, taxCode: null },
      { account: k.erloese19, debit: 0, credit: 287_82, taxCode: "USt19" },
      { account: k.ust19, debit: 0, credit: 54_68, taxCode: "USt19" },
    ]);
    expect(bareinnahmePosting({ behandlung: "regulaer", steuersatz: 700 }, 10_70, kr)).toEqual([
      { account: k.kasse, debit: 10_70, credit: 0, taxCode: null },
      { account: k.erloese7, debit: 0, credit: 10_00, taxCode: "USt7" },
      { account: k.ust7, debit: 0, credit: 70, taxCode: "USt7" },
    ]);
    expect(bareinnahmePosting({ behandlung: "kleinunternehmer", steuersatz: 0 }, 50_00, kr)).toEqual([
      { account: k.kasse, debit: 50_00, credit: 0, taxCode: null },
      { account: k.ku, debit: 0, credit: 50_00, taxCode: "KU" },
    ]);
    expect(bareinnahmePosting({ behandlung: "steuerfrei", steuersatz: 0 }, 80_00, kr)).toEqual([
      { account: k.kasse, debit: 80_00, credit: 0, taxCode: null },
      { account: k.frei, debit: 0, credit: 80_00, taxCode: "Steuerfrei" },
    ]);
    // Storno dreht die Seiten
    expect(bareinnahmePosting({ behandlung: "regulaer", steuersatz: 1900 }, -119_00, kr)).toEqual([
      { account: k.kasse, debit: 0, credit: 119_00, taxCode: null },
      { account: k.erloese19, debit: 100_00, credit: 0, taxCode: "USt19" },
      { account: k.ust19, debit: 19_00, credit: 0, taxCode: "USt19" },
    ]);
  });

  it("Netto, Steuer und Summen wie bei einer Rechnung", () => {
    expect(bareinnahmeAnteil({ behandlung: "regulaer", steuersatz: 1900 }, 119_00)).toEqual({ base: 100_00, tax: 19_00 });
    expect(bareinnahmeAnteil({ behandlung: "steuerfrei", steuersatz: 0 }, 80_00)).toEqual({ base: 80_00, tax: 0 });
    expect(bareinnahmeTotals({ behandlung: "regulaer", steuersatz: 700 }, 10_70)).toEqual({
      net: 10_00,
      tax: 70,
      gross: 10_70,
      taxes: [{ rate: 700, base: 10_00, tax: 70 }],
    });
  });

  it("prüft die Behandlung gegen den Kleinunternehmer-Stand am Tag der Bareinnahme", () => {
    expect(bareinnahmeFehler({ behandlung: "regulaer", steuersatz: 1900 }, false)).toBeNull();
    expect(bareinnahmeFehler({ behandlung: "regulaer", steuersatz: 700 }, false)).toBeNull();
    expect(bareinnahmeFehler({ behandlung: "steuerfrei", steuersatz: 0 }, false)).toBeNull();
    expect(bareinnahmeFehler({ behandlung: "regulaer", steuersatz: 0 }, false)).toMatch(/19 % oder 7 %/);
    expect(bareinnahmeFehler({ behandlung: "regulaer", steuersatz: 1600 }, false)).toMatch(/19 % oder 7 %/);
    expect(bareinnahmeFehler({ behandlung: "kleinunternehmer", steuersatz: 0 }, false)).toMatch(/nicht Kleinunternehmer/);
    expect(bareinnahmeFehler({ behandlung: "steuerfrei", steuersatz: 700 }, false)).toMatch(/ohne Steuer/);

    expect(bareinnahmeFehler({ behandlung: "kleinunternehmer", steuersatz: 0 }, true)).toBeNull();
    expect(bareinnahmeFehler({ behandlung: "steuerfrei", steuersatz: 0 }, true)).toBeNull();
    expect(bareinnahmeFehler({ behandlung: "regulaer", steuersatz: 1900 }, true)).toMatch(/§ 19 UStG/);
    expect(bareinnahmeFehler({ behandlung: "kleinunternehmer", steuersatz: 1900 }, true)).toMatch(/ohne Steuer/);
  });

  it("nennt die Behandlung kurz", () => {
    expect(bareinnahmeText({ behandlung: "regulaer", steuersatz: 1900 })).toBe("19 %");
    expect(bareinnahmeText({ behandlung: "kleinunternehmer", steuersatz: 0 })).toBe("Kleinunternehmer (§ 19 UStG)");
    expect(bareinnahmeText({ behandlung: "steuerfrei", steuersatz: 0 })).toBe("steuerfrei (§ 4 Nr. 8 bis 29 UStG)");
  });
});
