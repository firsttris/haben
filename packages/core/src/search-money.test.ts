import { describe, expect, it } from "vitest";
import { inCentRange, parseEuroSearchRange } from "./search-money.ts";

describe("parseEuroSearchRange", () => {
  it("trifft mit Cent genau einen Betrag", () => {
    expect(parseEuroSearchRange("119,50")).toEqual({ min: 11950, max: 11950 });
    expect(parseEuroSearchRange("1.234,56 €")).toEqual({ min: 123456, max: 123456 });
    expect(parseEuroSearchRange("-42,5")).toEqual({ min: -4250, max: -4250 });
    expect(parseEuroSearchRange("19.99")).toEqual({ min: 1999, max: 1999 });
    expect(parseEuroSearchRange("19.99 €")).toEqual({ min: 1999, max: 1999 });
    expect(parseEuroSearchRange("-42.5€")).toEqual({ min: -4250, max: -4250 });
  });

  it("trifft mit ganzem Euro alle Cent-Beträge dieses Euros", () => {
    expect(parseEuroSearchRange("1190")).toEqual({ min: 119000, max: 119099 });
    expect(parseEuroSearchRange("1.190")).toEqual({ min: 119000, max: 119099 });
    expect(parseEuroSearchRange("1190 €")).toEqual({ min: 119000, max: 119099 });
    expect(parseEuroSearchRange("-1190")).toEqual({ min: -119099, max: -119000 });
    expect(parseEuroSearchRange("0")).toEqual({ min: 0, max: 99 });
  });

  it("gibt null für Nummern, Text und Beträge zurück, die mit beiden Vorzeichen nicht in int4 passen", () => {
    expect(parseEuroSearchRange("")).toBeNull();
    expect(parseEuroSearchRange("RE-2026-001")).toBeNull();
    expect(parseEuroSearchRange("12.345.67")).toBeNull();
    expect(parseEuroSearchRange("99999999")).toBeNull();
    expect(parseEuroSearchRange("-21474836,48")).toBeNull();
    expect(parseEuroSearchRange("-21474836,47")).toEqual({ min: -2_147_483_647, max: -2_147_483_647 });
    // Ganzer Euro: der ganze Bereich muss passen, 21.474.836,99 € nicht mehr
    expect(parseEuroSearchRange("21474836")).toBeNull();
    expect(parseEuroSearchRange("21474835")).toEqual({ min: 2_147_483_500, max: 2_147_483_599 });
  });
});

describe("inCentRange", () => {
  it("prüft beide Grenzen einschließlich", () => {
    const range = { min: 119000, max: 119099 };
    expect([118999, 119000, 119047, 119099, 119100].map((c) => inCentRange(range, c))).toEqual([false, true, true, true, false]);
    expect(inCentRange(range, null)).toBe(false);
  });
});
