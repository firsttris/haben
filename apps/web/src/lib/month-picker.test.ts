import { describe, expect, it } from "vitest";
import { formatMonthLabel, formatMonthValue, initialViewYear, isMonthDisabled, parseMonth, yearBounds } from "./month-picker.ts";

describe("month-picker", () => {
  it("parst gültige JJJJ-MM-Werte und verwirft ungültige", () => {
    expect(parseMonth("2026-11")).toEqual({ year: 2026, month: 11 });
    expect(parseMonth("2026-01")).toEqual({ year: 2026, month: 1 });
    expect(parseMonth("2026-12")).toEqual({ year: 2026, month: 12 });
    expect(parseMonth("")).toBeNull();
    expect(parseMonth("2026-00")).toBeNull();
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-1")).toBeNull();
    expect(parseMonth("2026-11-01")).toBeNull();
  });

  it("formatiert Wert und deutsche Anzeige", () => {
    expect(formatMonthValue(2026, 1)).toBe("2026-01");
    expect(formatMonthValue(2026, 11)).toBe("2026-11");
    expect(formatMonthLabel("2026-03")).toBe("März 2026");
    expect(formatMonthLabel("2026-11")).toBe("November 2026");
    expect(formatMonthLabel("")).toBe("");
  });

  it("prüft Monatsgrenzen min und max", () => {
    expect(isMonthDisabled("2025-12", "2026-01", "2026-11")).toBe(true);
    expect(isMonthDisabled("2026-01", "2026-01", "2026-11")).toBe(false);
    expect(isMonthDisabled("2026-11", "2026-01", "2026-11")).toBe(false);
    expect(isMonthDisabled("2026-12", "2026-01", "2026-11")).toBe(true);
    expect(isMonthDisabled("2026-12")).toBe(false);
  });

  it("wählt das Startjahr aus Wert oder Grenzen", () => {
    expect(initialViewYear("2024-05", "2020-01", "2026-11", 2026)).toBe(2024);
    expect(initialViewYear("", "2020-01", "2025-12", 2026)).toBe(2025);
    expect(initialViewYear("", "2027-01", "2028-12", 2026)).toBe(2027);
    expect(initialViewYear("", undefined, undefined, 2026)).toBe(2026);
  });

  it("liest Jahresgrenzen aus min und max", () => {
    expect(yearBounds("2025-01", "2026-11")).toEqual({ minYear: 2025, maxYear: 2026 });
    expect(yearBounds(undefined, undefined)).toEqual({ minYear: undefined, maxYear: undefined });
  });
});
