import { describe, expect, it } from "vitest";
import { currentFilingPeriod, dueDate, parsePeriodKey, periodKey, periodLabel } from "./period.ts";

const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("dueDate", () => {
  it("10. des Folgemonats", () => {
    expect(iso(dueDate({ year: 2026, month: 10 }))).toBe("2026-11-10");
  });
  it("Samstag → Montag", () => {
    expect(iso(dueDate({ year: 2026, month: 9 }))).toBe("2026-10-12");
  });
  it("Sonntag → Montag", () => {
    expect(iso(dueDate({ year: 2026, month: 4 }))).toBe("2026-05-11");
  });
  it("Feiertage zählen nicht: Karfreitag und Ostermontag 2020", () => {
    expect(iso(dueDate({ year: 2020, month: 3 }))).toBe("2020-04-14");
  });
  it("Dezember → Januar des Folgejahres", () => {
    expect(iso(dueDate({ year: 2026, month: 12 }))).toBe("2027-01-11");
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
});
