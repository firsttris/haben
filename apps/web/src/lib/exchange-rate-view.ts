export type ExchangeRateViewMode = "month" | "currency" | "manual";

export interface ExchangeRateRow {
  currency: string;
  month: string;
  rate: string;
  source: "bmf" | "manuell";
  fetchedAt: Date | string;
}

export interface MonthOption {
  month: string;
  count: number;
  hasBmf: boolean;
}

export interface CurrencyOption {
  currency: string;
  count: number;
}

export interface ExchangeRateSummary {
  months: MonthOption[];
  currencies: CurrencyOption[];
  manualCount: number;
}

/** Fasst gespeicherte Kurse nach Monaten (neuester zuerst), Währungen (alphabetisch) und manuellen Einträgen zusammen */
export function summarizeExchangeRates(rates: readonly ExchangeRateRow[]): ExchangeRateSummary {
  const monthCounts = new Map<string, number>();
  const bmfMonths = new Set<string>();
  const currencyCounts = new Map<string, number>();
  let manualCount = 0;

  for (const r of rates) {
    monthCounts.set(r.month, (monthCounts.get(r.month) ?? 0) + 1);
    if (r.source === "bmf") bmfMonths.add(r.month);
    currencyCounts.set(r.currency, (currencyCounts.get(r.currency) ?? 0) + 1);
    if (r.source === "manuell") manualCount++;
  }

  const months = [...monthCounts.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, count]) => ({ month, count, hasBmf: bmfMonths.has(month) }));
  const currencies = [...currencyCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, count]) => ({ currency, count }));
  return { months, currencies, manualCount };
}

/** Wählt den bevorzugten Monat, sonst den neuesten BMF-Monat oder den neuesten verfügbaren */
export function resolveSelectedMonth(months: readonly MonthOption[], preferred: string): string {
  if (preferred && months.some((m) => m.month === preferred)) return preferred;
  return months.find((m) => m.hasBmf)?.month ?? months[0]?.month ?? "";
}

/** Wählt die bevorzugte Währung, sonst USD (falls vorhanden) oder die erste verfügbare */
export function resolveSelectedCurrency(currencies: readonly CurrencyOption[], preferred: string): string {
  if (preferred && currencies.some((c) => c.currency === preferred)) return preferred;
  if (currencies.some((c) => c.currency === "USD")) return "USD";
  return currencies[0]?.currency ?? "";
}

/** Filtert Kurse passend zur gewählten Ansicht (Monat, Währung oder nur eigene) */
export function filterExchangeRates<T extends ExchangeRateRow>(
  rates: readonly T[],
  options: { mode: ExchangeRateViewMode; month: string; currency: string; currencyQuery: string },
): T[] {
  const query = options.currencyQuery.trim().toUpperCase();
  if (options.mode === "manual") {
    return rates.filter((r) => r.source === "manuell" && (!query || r.currency.toUpperCase().includes(query)));
  }
  if (options.mode === "currency") {
    return rates.filter((r) => r.currency === options.currency).sort((a, b) => b.month.localeCompare(a.month));
  }
  return rates.filter((r) => r.month === options.month && (!query || r.currency.toUpperCase().includes(query)));
}
