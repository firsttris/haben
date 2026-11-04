import { describe, expect, it } from "vitest";
import { currentFilingPeriod, dueDate, isQuarter, monthsOfPeriod, parsePeriodKey, periodKey, periodLabel, quarterOfMonth } from "./period.ts";

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

describe("Quartale (Zeitraum 41–44 wie in ELSTER)", () => {
  it("Schlüssel, Bezeichnung und Monate", () => {
    expect(periodKey({ year: 2026, month: 43 })).toBe("2026-Q3");
    expect(parsePeriodKey("2026-Q3")).toEqual({ year: 2026, month: 43 });
    expect(parsePeriodKey("2026-Q5")).toBeNull();
    expect(parsePeriodKey("2026-41")).toBeNull();
    expect(periodLabel({ year: 2026, month: 41 })).toBe("1. Quartal 2026");
    expect(monthsOfPeriod({ year: 2026, month: 44 })).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ]);
    expect(monthsOfPeriod({ year: 2026, month: 5 })).toEqual([{ year: 2026, month: 5 }]);
    expect(quarterOfMonth(3)).toBe(41);
    expect(quarterOfMonth(4)).toBe(42);
    expect(isQuarter({ year: 2026, month: 42 })).toBe(true);
    expect(isQuarter({ year: 2026, month: 12 })).toBe(false);
  });
  it("fällig am 10. nach Quartalsende", () => {
    // 3. Quartal 2026: 10.10.2026 ist ein Samstag → Montag, 12.10.
    expect(dueDate({ year: 2026, month: 43 })).toBe("2026-10-12");
    // 4. Quartal: 10.01.2027 ist ein Sonntag → 11.01.
    expect(dueDate({ year: 2026, month: 44 })).toBe("2027-01-11");
  });
  it("mit Dauerfristverlängerung einen Monat später (§ 46 UStDV)", () => {
    expect(dueDate({ year: 2026, month: 10 }, null, true)).toBe("2026-12-10");
    // November → 10. Januar 2027 (Sonntag) → 11.01.
    expect(dueDate({ year: 2026, month: 11 }, null, true)).toBe("2027-01-11");
    // Dezember → 10. Februar 2027 (Mittwoch)
    expect(dueDate({ year: 2026, month: 12 }, null, true)).toBe("2027-02-10");
    // 4. Quartal → 10. Februar
    expect(dueDate({ year: 2026, month: 44 }, null, true)).toBe("2027-02-10");
    // 1. Quartal 2026 → 10. Mai 2026 (Sonntag) → 11.05.
    expect(dueDate({ year: 2026, month: 41 }, null, true)).toBe("2026-05-11");
  });
});
