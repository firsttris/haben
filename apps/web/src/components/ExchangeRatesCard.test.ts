import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExchangeRateRow } from "../lib/exchange-rate-view.ts";
import { ExchangeRatesList } from "./ExchangeRatesList.tsx";

const rates: ExchangeRateRow[] = [
  { currency: "USD", month: "2026-11", rate: "1.0750", source: "manuell", fetchedAt: "2026-11-10T09:00:00Z" },
  { currency: "CHF", month: "2026-10", rate: "0.9412", source: "bmf", fetchedAt: "2026-11-02T08:00:00Z" },
  { currency: "USD", month: "2026-10", rate: "1.0812", source: "bmf", fetchedAt: "2026-11-02T08:00:00Z" },
];

const noop = vi.fn();

describe("ExchangeRatesList", () => {
  it("zeigt ohne Kurse den Leerhinweis", () => {
    const markup = renderToStaticMarkup(
      createElement(ExchangeRatesList, {
        rates: [],
        mode: "month",
        month: "",
        currency: "",
        currencyQuery: "",
        busy: false,
        onModeChange: noop,
        onMonthChange: noop,
        onCurrencyChange: noop,
        onCurrencyQueryChange: noop,
        onDelete: noop,
      }),
    );
    expect(markup).toContain("Noch keine Kurse.");
  });

  it("zeigt in Nach-Monat-Ansicht nur den gewählten Monat ohne Monatsspalte", () => {
    const markup = renderToStaticMarkup(
      createElement(ExchangeRatesList, {
        rates,
        mode: "month",
        month: "2026-10",
        currency: "USD",
        currencyQuery: "",
        busy: false,
        onModeChange: noop,
        onMonthChange: noop,
        onCurrencyChange: noop,
        onCurrencyQueryChange: noop,
        onDelete: noop,
      }),
    );
    expect(markup).toContain("2 Kurse angezeigt · insgesamt 3 in 2 Monaten");
    expect(markup).toContain("CHF");
    expect(markup).toContain("USD");
    expect(markup).not.toContain("<th>Monat</th>");
    expect(markup).toContain("Nur eigene (1)");
  });

  it("zeigt in Nach-Währung-Ansicht alle Monate der Währung ohne Währungsspalte", () => {
    const markup = renderToStaticMarkup(
      createElement(ExchangeRatesList, {
        rates,
        mode: "currency",
        month: "2026-10",
        currency: "USD",
        currencyQuery: "",
        busy: false,
        onModeChange: noop,
        onMonthChange: noop,
        onCurrencyChange: noop,
        onCurrencyQueryChange: noop,
        onDelete: noop,
      }),
    );
    expect(markup).toContain("2 Kurse angezeigt · insgesamt 3 in 2 Monaten");
    expect(markup).toContain("<th>Monat</th>");
    expect(markup).not.toContain("<th>Währung</th>");
    expect(markup).toContain("Löschen");
  });
});
