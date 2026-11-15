import { describe, expect, it } from "vitest";
import { filterExchangeRates, resolveSelectedCurrency, resolveSelectedMonth, summarizeExchangeRates, type ExchangeRateRow } from "./exchange-rate-view.ts";

const sample: ExchangeRateRow[] = [
  { currency: "CHF", month: "2026-10", rate: "0.9412", source: "bmf", fetchedAt: "2026-11-02T08:00:00Z" },
  { currency: "GBP", month: "2026-10", rate: "0.8345", source: "bmf", fetchedAt: "2026-11-02T08:00:00Z" },
  { currency: "USD", month: "2026-10", rate: "1.0812", source: "bmf", fetchedAt: "2026-11-02T08:00:00Z" },
  { currency: "CHF", month: "2026-09", rate: "0.9380", source: "bmf", fetchedAt: "2026-10-01T08:00:00Z" },
  { currency: "USD", month: "2026-09", rate: "1.0950", source: "bmf", fetchedAt: "2026-10-01T08:00:00Z" },
  { currency: "USD", month: "2026-11", rate: "1.0700", source: "manuell", fetchedAt: "2026-11-10T09:00:00Z" },
];

describe("summarizeExchangeRates", () => {
  it("sortiert Monate absteigend, Währungen alphabetisch und zählt manuelle Kurse", () => {
    const summary = summarizeExchangeRates(sample);
    expect(summary.months).toEqual([
      { month: "2026-11", count: 1 },
      { month: "2026-10", count: 3 },
      { month: "2026-09", count: 2 },
    ]);
    expect(summary.currencies).toEqual([
      { currency: "CHF", count: 2 },
      { currency: "GBP", count: 1 },
      { currency: "USD", count: 3 },
    ]);
    expect(summary.manualCount).toBe(1);
  });
});

describe("resolveSelectedMonth / resolveSelectedCurrency", () => {
  const summary = summarizeExchangeRates(sample);

  it("behält gültigen Monat oder fällt auf den neuesten zurück", () => {
    expect(resolveSelectedMonth(summary.months, "2026-09")).toBe("2026-09");
    expect(resolveSelectedMonth(summary.months, "2025-01")).toBe("2026-11");
    expect(resolveSelectedMonth([], "2026-10")).toBe("");
  });

  it("behält gültige Währung, bevorzugt sonst USD und fällt auf die erste zurück", () => {
    expect(resolveSelectedCurrency(summary.currencies, "CHF")).toBe("CHF");
    expect(resolveSelectedCurrency(summary.currencies, "JPY")).toBe("USD");
    expect(resolveSelectedCurrency([{ currency: "AUD", count: 1 }], "")).toBe("AUD");
    expect(resolveSelectedCurrency([], "")).toBe("");
  });
});

describe("filterExchangeRates", () => {
  it("filtert nach Monat und optionalem Währungs-Suchbegriff", () => {
    const oct = filterExchangeRates(sample, { mode: "month", month: "2026-10", currency: "USD", currencyQuery: "" });
    expect(oct.map((r) => r.currency)).toEqual(["CHF", "GBP", "USD"]);

    const octUsd = filterExchangeRates(sample, { mode: "month", month: "2026-10", currency: "USD", currencyQuery: " us " });
    expect(octUsd.map((r) => r.currency)).toEqual(["USD"]);

    const octNone = filterExchangeRates(sample, { mode: "month", month: "2026-10", currency: "USD", currencyQuery: "JPY" });
    expect(octNone).toEqual([]);
  });

  it("filtert nach Währung über alle Monate hinweg (neuester Monat zuerst)", () => {
    const usd = filterExchangeRates(sample, { mode: "currency", month: "2026-10", currency: "USD", currencyQuery: "" });
    expect(usd.map((r) => r.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
  });

  it("filtert nur manuell eingetragene Kurse (auch mit Suchbegriff)", () => {
    const manual = filterExchangeRates(sample, { mode: "manual", month: "2026-10", currency: "USD", currencyQuery: "" });
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ currency: "USD", month: "2026-11", source: "manuell" });

    const manualMiss = filterExchangeRates(sample, { mode: "manual", month: "2026-10", currency: "USD", currencyQuery: "CHF" });
    expect(manualMiss).toEqual([]);
  });
});
