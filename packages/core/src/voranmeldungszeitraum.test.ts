import { describe, expect, it } from "vitest";
import {
  filingPeriodOfMonth,
  filingPeriodsOfYear,
  frequencyAt,
  latestEndedPeriod,
  periodMatchesFrequency,
  recentFilingPeriods,
  suggestFrequency,
  type VatFrequencySetting,
} from "./voranmeldungszeitraum.ts";

const quartal2026: VatFrequencySetting[] = [{ year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" }];

describe("frequencyAt", () => {
  it("ohne Einstellung monatlich, wie bisher", () => {
    expect(frequencyAt([], { year: 2026, month: 5 })).toBe("monatlich");
  });
  it("gilt ab dem Jahr und wird in Folgejahre übernommen", () => {
    expect(frequencyAt(quartal2026, { year: 2025, month: 12 })).toBe("monatlich");
    expect(frequencyAt(quartal2026, { year: 2026, month: 1 })).toBe("vierteljaehrlich");
    expect(frequencyAt(quartal2026, { year: 2027, month: 6 })).toBe("vierteljaehrlich");
  });
  it("Wechsel im Jahr ab einem Quartal, etwa wenn das Finanzamt ihn festlegt", () => {
    const settings: VatFrequencySetting[] = [...quartal2026, { year: 2026, fromMonth: 7, frequency: "monatlich" }];
    expect(frequencyAt(settings, { year: 2026, month: 6 })).toBe("vierteljaehrlich");
    expect(frequencyAt(settings, { year: 2026, month: 7 })).toBe("monatlich");
    expect(filingPeriodsOfYear(settings, 2026)).toEqual([
      { year: 2026, month: 41 },
      { year: 2026, month: 42 },
      ...[7, 8, 9, 10, 11, 12].map((month) => ({ year: 2026, month })),
    ]);
  });
});

describe("Zeiträume", () => {
  it("Monat zum Quartal, befreit ohne Zeitraum", () => {
    expect(filingPeriodOfMonth({ year: 2026, month: 8 }, "vierteljaehrlich")).toEqual({ year: 2026, month: 43 });
    expect(filingPeriodOfMonth({ year: 2026, month: 8 }, "monatlich")).toEqual({ year: 2026, month: 8 });
    expect(filingPeriodOfMonth({ year: 2026, month: 8 }, "keine")).toBeNull();
  });
  it("alle Zeiträume eines Jahres", () => {
    expect(filingPeriodsOfYear(quartal2026, 2026).map((p) => p.month)).toEqual([41, 42, 43, 44]);
    expect(filingPeriodsOfYear([], 2026)).toHaveLength(12);
    expect(filingPeriodsOfYear([{ year: 2026, fromMonth: 1, frequency: "keine" }], 2026)).toEqual([]);
  });
  it("passt der Zeitraum zur Einstellung?", () => {
    expect(periodMatchesFrequency(quartal2026, { year: 2026, month: 43 })).toBe(true);
    expect(periodMatchesFrequency(quartal2026, { year: 2026, month: 8 })).toBe(false);
    expect(periodMatchesFrequency([], { year: 2026, month: 43 })).toBe(false);
    expect(periodMatchesFrequency([], { year: 2026, month: 8 })).toBe(true);
  });
  it("Auswahl der letzten Zeiträume, neueste zuerst", () => {
    const wechsel: VatFrequencySetting[] = [{ year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" }];
    expect(recentFilingPeriods(wechsel, { year: 2026, month: 2 }, 4)).toEqual([
      { year: 2026, month: 41 },
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
    ]);
    expect(recentFilingPeriods([{ year: 2026, fromMonth: 1, frequency: "keine" }], { year: 2026, month: 3 }, 3)).toEqual([]);
  });
  it("zuletzt abgelaufener Zeitraum", () => {
    expect(latestEndedPeriod([], { year: 2026, month: 11 })).toEqual({ year: 2026, month: 10 });
    // Im November ist das 4. Quartal noch nicht vorbei: das 3. ist abzugeben
    expect(latestEndedPeriod(quartal2026, { year: 2026, month: 11 })).toEqual({ year: 2026, month: 43 });
    expect(latestEndedPeriod(quartal2026, { year: 2027, month: 1 })).toEqual({ year: 2026, month: 44 });
    // Im Januar nach dem Wechsel von monatlich auf vierteljährlich: der Dezember
    expect(latestEndedPeriod([{ year: 2027, fromMonth: 1, frequency: "vierteljaehrlich" }], { year: 2027, month: 2 })).toEqual({ year: 2026, month: 12 });
    // Befreit: der letzte Zeitraum davor, nach zwei Jahren keiner mehr
    const befreit: VatFrequencySetting[] = [{ year: 2026, fromMonth: 1, frequency: "keine" }];
    expect(latestEndedPeriod(befreit, { year: 2026, month: 5 })).toEqual({ year: 2025, month: 12 });
    expect(latestEndedPeriod(befreit, { year: 2028, month: 5 })).toBeNull();
  });
});

describe("suggestFrequency (§ 18 Abs. 2 UStG)", () => {
  const basis = { year: 2027, firstActivity: "2020-01" };
  it("mehr als 9.000 € Steuer im Vorjahr: monatlich", () => {
    expect(suggestFrequency({ ...basis, previousYearTax: 900_001 })?.frequency).toBe("monatlich");
  });
  it("genau 9.000 €: vierteljährlich", () => {
    expect(suggestFrequency({ ...basis, previousYearTax: 900_000 })?.frequency).toBe("vierteljaehrlich");
  });
  it("bis 2.000 €: Befreiung möglich", () => {
    const suggestion = suggestFrequency({ ...basis, previousYearTax: 200_000 });
    expect(suggestion?.frequency).toBe("keine");
    expect(suggestion?.reason).toContain("§ 18 Abs. 2 Satz 3 UStG");
    expect(suggestFrequency({ ...basis, previousYearTax: 200_001 })?.frequency).toBe("vierteljaehrlich");
  });
  it("Überschuss über 9.000 €: Hinweis auf die Wahl nach § 18 Abs. 2a", () => {
    expect(suggestFrequency({ ...basis, previousYearTax: -1_000_000 })?.reason).toContain("§ 18 Abs. 2a UStG");
  });
  it("bis 2024 die Grenzen 7.500 € und 1.000 € (vor dem Bürokratieentlastungsgesetz IV)", () => {
    const vorher = { year: 2024, firstActivity: "2015-01" };
    expect(suggestFrequency({ ...vorher, previousYearTax: 800_000 })?.frequency).toBe("monatlich");
    expect(suggestFrequency({ ...vorher, previousYearTax: 750_000 })?.frequency).toBe("vierteljaehrlich");
    expect(suggestFrequency({ ...vorher, previousYearTax: 150_000 })?.frequency).toBe("vierteljaehrlich");
    expect(suggestFrequency({ ...vorher, previousYearTax: 100_000 })?.frequency).toBe("keine");
  });
  it("ohne Zahlen kein Vorschlag", () => {
    expect(suggestFrequency({ ...basis, previousYearTax: null })).toBeNull();
  });
  it("Neugründung ab 2027: im Gründungs- und im Folgejahr monatlich (Satz 4)", () => {
    expect(suggestFrequency({ year: 2027, previousYearTax: 10_000, firstActivity: "2026-09" })?.frequency).toBe("monatlich");
    expect(suggestFrequency({ year: 2027, previousYearTax: null, firstActivity: "2027-02" })?.frequency).toBe("monatlich");
  });
  it("Neugründung 2021–2026: Vorjahressteuer auf ein Jahr hochgerechnet (Satz 6)", () => {
    // 3.000 € in vier Monaten (September bis Dezember 2025) → 9.000 € im Jahr: vierteljährlich
    const quarterly = suggestFrequency({ year: 2026, previousYearTax: 300_000, firstActivity: "2025-09" });
    expect(quarterly?.frequency).toBe("vierteljaehrlich");
    expect(quarterly?.reason).toContain("4 Monate");
    expect(suggestFrequency({ year: 2026, previousYearTax: 300_001, firstActivity: "2025-09" })?.frequency).toBe("monatlich");
    // Im Gründungsjahr zählt die voraussichtliche Steuer, die Haben nicht kennt
    expect(suggestFrequency({ year: 2026, previousYearTax: null, firstActivity: "2026-03" })).toBeNull();
  });
});
