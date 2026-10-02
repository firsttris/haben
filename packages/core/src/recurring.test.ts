import { describe, expect, it } from "vitest";
import { addMonthsAnchored, dueDates, fillPlaceholders, servicePeriodFor } from "./recurring.ts";

describe("wiederkehrende Rechnungen", () => {
  it("Monatsende bleibt am Ankertag", () => {
    expect(addMonthsAnchored("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonthsAnchored("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonthsAnchored("2026-11-15", 3, 15)).toBe("2027-02-15");
    expect(addMonthsAnchored("2028-01-31", 1, 31)).toBe("2028-02-29");
  });

  it("Leistungszeitraum laufend und vergangen", () => {
    expect(servicePeriodFor("2026-11-03", 1, "laufend")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(servicePeriodFor("2026-01-03", 1, "vorher")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(servicePeriodFor("2026-11-03", 3, "laufend")).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(servicePeriodFor("2026-11-03", 12, "keiner")).toBeNull();
  });

  it("Platzhalter", () => {
    expect(fillPlaceholders("Wartung {monat} {jahr} ({quartal})", { from: "2026-11-01", to: "2026-11-30" })).toBe("Wartung November 2026 (Q4)");
    expect(fillPlaceholders("Hosting {zeitraum}", { from: "2026-10-01", to: "2026-12-31" })).toBe("Hosting Oktober – Dezember 2026");
    expect(fillPlaceholders("{zeitraum}", { from: "2026-11-01", to: "2027-01-31" })).toBe("November 2026 – Januar 2027");
  });

  it("holt verpasste Termine nach, bis zum Enddatum", () => {
    expect(dueDates("2026-08-01", 1, 1, "2026-10-02", null)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(dueDates("2026-08-01", 1, 1, "2026-10-02", "2026-09-15")).toEqual(["2026-08-01", "2026-09-01"]);
    expect(dueDates("2026-11-01", 1, 1, "2026-10-02", null)).toEqual([]);
  });
});
