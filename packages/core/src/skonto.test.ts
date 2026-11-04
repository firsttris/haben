import { describe, expect, it } from "vitest";
import { parseSkontoTerms, skontoOffer } from "./skonto.ts";

describe("parseSkontoTerms", () => {
  it("liest die Skontozeilen nach BR-DE-18 (Beispiel 01.10a der XRechnung-Testsuite)", () => {
    expect(parseSkontoTerms("#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\n#SKONTO#TAGE=30#PROZENT=0.00#\n")).toEqual([
      { days: 7, percent: 200 },
      { days: 14, percent: 100 },
    ]);
  });

  it("liest den Basisbetrag und übergeht andere Texte", () => {
    expect(parseSkontoTerms("Zahlbar in 30 Tagen\r\n#SKONTO#TAGE=10#PROZENT=3.50#BASISBETRAG=100.05#")).toEqual([{ days: 10, percent: 350, base: 10_005 }]);
    expect(parseSkontoTerms("#skonto#tage=7#prozent=2.00#")).toEqual([]);
    expect(parseSkontoTerms("#SKONTO#TAGE=7#PROZENT=2#")).toEqual([]);
    expect(parseSkontoTerms("")).toEqual([]);
  });
});

describe("skontoOffer", () => {
  const terms = [
    { days: 7, percent: 200 },
    { days: 14, percent: 100 },
  ];

  it("nimmt das höchste Skonto, dessen Frist am Zahltag läuft", () => {
    expect(skontoOffer(terms, "2026-11-01", "2026-11-08", 11_900)).toEqual({ term: terms[0], until: "2026-11-08", amount: 238 });
    expect(skontoOffer(terms, "2026-11-01", "2026-11-09", 11_900)).toEqual({ term: terms[1], until: "2026-11-15", amount: 119 });
    expect(skontoOffer(terms, "2026-11-01", "2026-11-16", 11_900)).toBeNull();
  });

  it("rechnet vom Basisbetrag und rundet kaufmännisch", () => {
    expect(skontoOffer([{ days: 10, percent: 300, base: 5_050 }], "2026-11-01", "2026-11-02", 20_000)?.amount).toBe(152);
    expect(skontoOffer([{ days: 10, percent: 200 }], "2026-11-01", "2026-11-02", 25)?.amount).toBe(1);
  });

  it("bietet kein Skonto an, das den ganzen Betrag oder nichts abzöge", () => {
    expect(skontoOffer([{ days: 10, percent: 200 }], "2026-11-01", "2026-11-02", 20)).toBeNull();
    expect(skontoOffer([{ days: 10, percent: 10_000 }], "2026-11-01", "2026-11-02", 500)).toBeNull();
  });
});
