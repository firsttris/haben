import { formatExchangeRate, formatRateMonth } from "@haben/core";
import {
  type CurrencyOption,
  type ExchangeRateRow,
  type ExchangeRateViewMode,
  filterExchangeRates,
  type MonthOption,
  resolveSelectedCurrency,
  resolveSelectedMonth,
  summarizeExchangeRates,
} from "../lib/exchange-rate-view.ts";
import { formatDateTime } from "../lib/format.ts";
import { Field } from "./Field.tsx";
import { ScrollTable } from "./ScrollTable.tsx";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ExchangeRatesFilterBar({
  activeMode,
  manualCount,
  months,
  currencies,
  activeMonth,
  activeCurrency,
  currencyQuery,
  onModeChange,
  onMonthChange,
  onCurrencyChange,
  onCurrencyQueryChange,
}: {
  activeMode: ExchangeRateViewMode;
  manualCount: number;
  months: readonly MonthOption[];
  currencies: readonly CurrencyOption[];
  activeMonth: string;
  activeCurrency: string;
  currencyQuery: string;
  onModeChange: (mode: ExchangeRateViewMode) => void;
  onMonthChange: (month: string) => void;
  onCurrencyChange: (currency: string) => void;
  onCurrencyQueryChange: (query: string) => void;
}) {
  return (
    <div className="filter-row" style={{ marginBottom: 0 }}>
      <div className="segmented" role="group" aria-label="Darstellung der Kurse">
        <button type="button" className="btn" aria-pressed={activeMode === "month"} onClick={() => onModeChange("month")}>
          Nach Monat
        </button>
        <button type="button" className="btn" aria-pressed={activeMode === "currency"} onClick={() => onModeChange("currency")}>
          Nach Währung
        </button>
        {manualCount > 0 && (
          <button type="button" className="btn" aria-pressed={activeMode === "manual"} onClick={() => onModeChange("manual")}>
            Nur eigene ({manualCount})
          </button>
        )}
      </div>

      {activeMode === "month" && (
        <Field label="Monat">
          {(control) => (
            <select {...control} value={activeMonth} onChange={(e) => onMonthChange(e.target.value)}>
              {months.map((m) => (
                <option key={m.month} value={m.month}>
                  {formatRateMonth(m.month)} ({m.count})
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {activeMode === "currency" && (
        <Field label="Währung">
          {(control) => (
            <select {...control} value={activeCurrency} onChange={(e) => onCurrencyChange(e.target.value)} className="mono">
              {currencies.map((c) => (
                <option key={c.currency} value={c.currency}>
                  {c.currency} ({c.count})
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {activeMode !== "currency" && (
        <Field label="Währung filtern">
          {(control) => (
            <input
              {...control}
              type="search"
              value={currencyQuery}
              onChange={(e) => onCurrencyQueryChange(e.target.value)}
              placeholder="z. B. USD"
              className="mono"
            />
          )}
        </Field>
      )}
    </div>
  );
}

function ExchangeRatesTable({
  visible,
  showMonthCol,
  showCurrencyCol,
  busy,
  onDelete,
}: {
  visible: readonly ExchangeRateRow[];
  showMonthCol: boolean;
  showCurrencyCol: boolean;
  busy: boolean;
  onDelete: (currency: string, month: string) => void;
}) {
  if (visible.length === 0) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Keine Kurse für diesen Filter.
      </p>
    );
  }
  return (
    <ScrollTable className="report-table">
      <thead>
        <tr>
          {showMonthCol && <th>Monat</th>}
          {showCurrencyCol && <th>Währung</th>}
          <th className="num">1 EUR =</th>
          <th>Quelle</th>
          <th>
            <span className="visually-hidden">Aktion</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {visible.map((r) => (
          <tr key={`${r.currency}-${r.month}`}>
            {showMonthCol && <td>{formatRateMonth(r.month)}</td>}
            {showCurrencyCol && <td className="mono">{r.currency}</td>}
            <td className="num">{formatExchangeRate(r.rate)}</td>
            <td className="small">{r.source === "bmf" ? `BMF, abgerufen ${formatDateTime(r.fetchedAt)}` : "von Hand"}</td>
            <td>
              {r.source === "manuell" && (
                <button type="button" className="link-button" disabled={busy} onClick={() => onDelete(r.currency, r.month)}>
                  Löschen
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** Kompakte Darstellung der gespeicherten Kurse: nach Monat, nach Währung oder nur eigene Einträge */
export function ExchangeRatesList({
  rates,
  mode,
  month,
  currency,
  currencyQuery,
  busy,
  onModeChange,
  onMonthChange,
  onCurrencyChange,
  onCurrencyQueryChange,
  onDelete,
}: {
  rates: readonly ExchangeRateRow[];
  mode: ExchangeRateViewMode;
  month: string;
  currency: string;
  currencyQuery: string;
  busy: boolean;
  onModeChange: (mode: ExchangeRateViewMode) => void;
  onMonthChange: (month: string) => void;
  onCurrencyChange: (currency: string) => void;
  onCurrencyQueryChange: (query: string) => void;
  onDelete: (currency: string, month: string, remainingManual: number) => void;
}) {
  if (rates.length === 0) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Noch keine Kurse.
      </p>
    );
  }

  const { months, currencies, manualCount } = summarizeExchangeRates(rates);
  const activeMode: ExchangeRateViewMode = mode === "manual" && manualCount === 0 ? "month" : mode;
  const activeMonth = resolveSelectedMonth(months, month);
  const activeCurrency = resolveSelectedCurrency(currencies, currency);
  const visible = filterExchangeRates(rates, { mode: activeMode, month: activeMonth, currency: activeCurrency, currencyQuery });

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ExchangeRatesFilterBar
        activeMode={activeMode}
        manualCount={manualCount}
        months={months}
        currencies={currencies}
        activeMonth={activeMonth}
        activeCurrency={activeCurrency}
        currencyQuery={currencyQuery}
        onModeChange={onModeChange}
        onMonthChange={onMonthChange}
        onCurrencyChange={onCurrencyChange}
        onCurrencyQueryChange={onCurrencyQueryChange}
      />
      <p className="small muted" style={{ margin: 0 }}>
        {plural(visible.length, "Kurs", "Kurse")} angezeigt · insgesamt {rates.length} in {plural(months.length, "Monat", "Monaten")}
      </p>
      <ExchangeRatesTable
        visible={visible}
        showMonthCol={activeMode !== "month"}
        showCurrencyCol={activeMode !== "currency"}
        busy={busy}
        onDelete={(c, m) => onDelete(c, m, manualCount - 1)}
      />
    </div>
  );
}
