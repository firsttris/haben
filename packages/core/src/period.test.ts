import { describe, expect, it } from "vitest";
import { currentFilingPeriod, dueDate, parsePeriodKey, periodKey, periodLabel } from "./period.ts";

describe("dueDate", () => {
  it("10. des Folgemonats", () => {
    expect(dueDate({ year: 2026, month: 10 })).toBe("2026-11-10");
  });
  it("Samstag → Montag", () => {
    expect(dueDate({ year: 2026, month: 9 })).toBe("2026-10-12");
  });
  it("Sonntag → Montag", () => {
    expect(dueDate({ year: 2026, month: 4 })).toBe("2026-05-11");
  });
  it("Feiertage zählen nicht: Karfreitag und Ostermontag 2020", () => {
    expect(dueDate({ year: 2020, month: 3 })).toBe("2020-04-14");
  });
  it("Dezember → Januar des Folgejahres", () => {
    expect(dueDate({ year: 2026, month: 12 })).toBe("2027-01-11");
  });
});

describe("Zeitraum", () => {
  it("Schlüssel hin und zurück", () => {
    expect(periodKey({ year: 2026, month: 9 })).toBe("2026-09");
    expect(parsePeriodKey("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parsePeriodKey("2026-13")).toBeNull();
    expect(parsePeriodKey("x")).toBeNull();
  });
  it("Bezeichnung", () => {
    expect(periodLabel({ year: 2026, month: 3 })).toBe("März 2026");
  });
  it("abzugeben ist der Vormonat", () => {
    expect(currentFilingPeriod(new Date(2026, 9, 2))).toEqual({ year: 2026, month: 9 });
    expect(currentFilingPeriod(new Date(2027, 0, 5))).toEqual({ year: 2026, month: 12 });
  });
  it("Monatswechsel nach deutscher Zeit, unabhängig von der Zeitzone des Prozesses", () => {
    // 31.10.2026 23:30 UTC ist in Deutschland schon der 1. November (MEZ): abzugeben ist der Oktober
    expect(currentFilingPeriod(new Date("2026-10-31T23:30:00Z"))).toEqual({ year: 2026, month: 10 });
    // 30.06.2026 22:30 UTC ist der 1. Juli 00:30 (MESZ)
    expect(currentFilingPeriod(new Date("2026-06-30T22:30:00Z"))).toEqual({ year: 2026, month: 6 });
    // Silvester: 31.12.2026 23:30 UTC ist schon 2027
    expect(currentFilingPeriod(new Date("2026-12-31T23:30:00Z"))).toEqual({ year: 2026, month: 12 });
    // Kurz vor Mitternacht in Deutschland bleibt es beim alten Monat
    expect(currentFilingPeriod(new Date("2026-10-31T22:30:00Z"))).toEqual({ year: 2026, month: 9 });
  });
});
