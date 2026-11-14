import { describe, expect, it } from "vitest";
import { datevZeitraumBereich, datevZeitraumKey, parseDatevZeitraum } from "./datev-zeitraum.ts";

describe("DATEV-Zeitraum", () => {
  it("parst ganzes Jahr, Quartale und Monate; lehnt ungültige Werte ab", () => {
    expect(parseDatevZeitraum(undefined)).toEqual({ kind: "jahr" });
    expect(parseDatevZeitraum(null)).toEqual({ kind: "jahr" });
    expect(parseDatevZeitraum("")).toEqual({ kind: "jahr" });
    expect(parseDatevZeitraum("jahr")).toEqual({ kind: "jahr" });
    expect(parseDatevZeitraum("Q1")).toEqual({ kind: "quartal", quartal: 1 });
    expect(parseDatevZeitraum("q4")).toEqual({ kind: "quartal", quartal: 4 });
    expect(parseDatevZeitraum("03")).toEqual({ kind: "monat", monat: 3 });
    expect(parseDatevZeitraum("3")).toEqual({ kind: "monat", monat: 3 });
    expect(parseDatevZeitraum("12")).toEqual({ kind: "monat", monat: 12 });

    expect(parseDatevZeitraum("0")).toBeNull();
    expect(parseDatevZeitraum("00")).toBeNull();
    expect(parseDatevZeitraum("13")).toBeNull();
    expect(parseDatevZeitraum("Q0")).toBeNull();
    expect(parseDatevZeitraum("Q5")).toBeNull();
    expect(parseDatevZeitraum("2026-03")).toBeNull();
    expect(parseDatevZeitraum("foo")).toBeNull();
  });

  it("liefert Schlüssel für URL und Auswahlfeld", () => {
    expect(datevZeitraumKey({ kind: "jahr" })).toBe("");
    expect(datevZeitraumKey({ kind: "quartal", quartal: 2 })).toBe("Q2");
    expect(datevZeitraumKey({ kind: "monat", monat: 3 })).toBe("03");
    expect(datevZeitraumKey({ kind: "monat", monat: 11 })).toBe("11");
  });

  it("berechnet Datumsbereich, Dateiname und Bezeichnung für Jahr, Quartal und Monat inklusive Schaltjahr", () => {
    expect(datevZeitraumBereich(2026, { kind: "jahr" })).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      filename: "EXTF_Buchungsstapel_2026.csv",
      description: "Haben 2026",
    });

    expect(datevZeitraumBereich(2026, { kind: "quartal", quartal: 1 })).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
      filename: "EXTF_Buchungsstapel_2026-Q1.csv",
      description: "Haben 2026 Q1",
    });
    expect(datevZeitraumBereich(2026, { kind: "quartal", quartal: 2 })).toEqual({
      dateFrom: "2026-04-01",
      dateTo: "2026-06-30",
      filename: "EXTF_Buchungsstapel_2026-Q2.csv",
      description: "Haben 2026 Q2",
    });
    expect(datevZeitraumBereich(2026, { kind: "quartal", quartal: 3 })).toEqual({
      dateFrom: "2026-07-01",
      dateTo: "2026-09-30",
      filename: "EXTF_Buchungsstapel_2026-Q3.csv",
      description: "Haben 2026 Q3",
    });
    expect(datevZeitraumBereich(2026, { kind: "quartal", quartal: 4 })).toEqual({
      dateFrom: "2026-10-01",
      dateTo: "2026-12-31",
      filename: "EXTF_Buchungsstapel_2026-Q4.csv",
      description: "Haben 2026 Q4",
    });

    expect(datevZeitraumBereich(2026, { kind: "monat", monat: 3 })).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      filename: "EXTF_Buchungsstapel_2026-03.csv",
      description: "Haben 2026-03",
    });
    // Schaltjahr vs. Nicht-Schaltjahr
    expect(datevZeitraumBereich(2024, { kind: "monat", monat: 2 })).toMatchObject({ dateFrom: "2024-02-01", dateTo: "2024-02-29" });
    expect(datevZeitraumBereich(2026, { kind: "monat", monat: 2 })).toMatchObject({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  });
});
