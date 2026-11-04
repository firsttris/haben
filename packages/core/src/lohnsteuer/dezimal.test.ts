import { describe, expect, it } from "vitest";
import { alsGanzzahl, alsText, dez, ganzzahl, geteilt, geteiltExakt, mal, minus, plus, runden, vergleich } from "./dezimal.ts";

describe("dezimal", () => {
  it("rechnet ohne Rundungsfehler der Gleitkommazahlen", () => {
    // Als number ergibt 0,42 · 78.069 den Wert 32788.979999…
    expect(alsText(mal(dez("0.42"), dez("78069")))).toBe("32788.98");
    expect(alsText(plus(dez("0.1"), dez("0.2")))).toBe("0.3");
    expect(alsText(minus(dez("1"), dez("1.005")))).toBe("-0.005");
  });

  it("rundet wie BigDecimal: ROUND_DOWN Richtung null, ROUND_UP von null weg", () => {
    expect(alsText(runden(dez("4.567"), 2, "ab"))).toBe("4.56");
    expect(alsText(runden(dez("4.561"), 2, "auf"))).toBe("4.57");
    expect(alsText(runden(dez("4.56"), 2, "auf"))).toBe("4.56");
    expect(alsText(runden(dez("-4.5"), 0, "ab"))).toBe("-4");
    expect(alsText(runden(dez("-4.5"), 0, "auf"))).toBe("-5");
    expect(alsText(runden(dez("3"), 2, "ab"))).toBe("3.00");
  });

  it("teilt mit vorgegebenen Stellen und genau", () => {
    expect(alsText(geteilt(dez("100"), dez("12"), 0, "ab"))).toBe("8");
    expect(alsText(geteilt(dez("100"), dez("12"), 2, "auf"))).toBe("8.34");
    expect(alsText(geteilt(dez("0.5"), dez("0.03"), 3, "ab"))).toBe("16.666");
    expect(alsText(geteiltExakt(dez("2.5"), dez("2")))).toBe("1.25");
    expect(alsText(geteiltExakt(dez("1.25"), dez("100")))).toBe("0.0125");
    expect(() => geteiltExakt(dez("1"), dez("3"))).toThrow(RangeError);
    expect(() => geteilt(dez("1"), dez("0"), 2, "ab")).toThrow(RangeError);
  });

  it("vergleicht nach dem Wert, nicht nach den Stellen", () => {
    expect(vergleich(dez("1.50"), dez("1.5"))).toBe(0);
    expect(vergleich(dez("-1"), dez("0.001"))).toBe(-1);
    expect(vergleich(ganzzahl(250, 2), dez("2.49"))).toBe(1);
  });

  it("gibt ganze Werte als number zurück und lehnt Bruchteile ab", () => {
    expect(alsGanzzahl(dez("81741.00"))).toBe(81_741);
    expect(() => alsGanzzahl(dez("1.5"))).toThrow(RangeError);
    expect(() => dez("1,5")).toThrow(RangeError);
    expect(() => ganzzahl(0.5)).toThrow(RangeError);
  });
});
