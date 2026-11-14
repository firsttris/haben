import { allocateSplitTax, formatDecimal, formatEuro, parseEuro, type ExpenseCategory } from "@haben/core";
import { EigenesKontoWahl, passendesKonto, type OwnAccountChoice } from "./EigenesKontoWahl.tsx";
import { Field } from "./Field.tsx";

/*
 * Aufteilung eines Belegs auf mehrere Kategorien (#271): Zeilen mit Kategorie, Steuersatz und Netto. Die Vorsteuer je
 * Zeile verteilt Haben aus der Vorsteuer des Satzes (wie beim Speichern, allocateSplitTax); die Summen je Satz werden
 * laufend gegen die Beträge des Belegs geprüft.
 */

type Rate = 1900 | 700 | 0;

export interface SplitRowState {
  key: number;
  category: ExpenseCategory | "";
  taxRate: Rate;
  net: string;
  /** Eigenes Sachkonto der Zeile (#270); leer = das Konto der Kategorie */
  ownAccountId: string;
}

let nextSplitKey = 1;

export function splitRow(category: ExpenseCategory | "", taxRate: Rate, net: string, ownAccountId = ""): SplitRowState {
  return { key: nextSplitKey++, category, taxRate, net, ownAccountId };
}

/** Eingegebene Zeilen als Daten; null, wenn eine Zeile noch keine Kategorie oder kein lesbares Netto hat */
export function parseSplitRows(rows: SplitRowState[]): { category: ExpenseCategory; taxRate: Rate; net: number; ownAccountId: string | null }[] | null {
  const parsed = rows.map((row) => ({ category: row.category, taxRate: row.taxRate, net: parseEuro(row.net || "0"), ownAccountId: row.ownAccountId || null }));
  if (parsed.some((p) => p.category === "" || p.net === null)) return null;
  return parsed.map((p) => ({ category: p.category as ExpenseCategory, taxRate: p.taxRate, net: p.net!, ownAccountId: p.ownAccountId }));
}

const percent = (rate: number) => `${rate / 100} %`;

export function DocumentSplits({
  rows,
  amounts,
  categories,
  ownAccounts = [],
  disabled,
  onChange,
  onDissolve,
  taxLabel = "Vorsteuer",
}: {
  rows: SplitRowState[];
  /** Beträge des Belegs je Satz in Euro; null, solange ein Betrag oben nicht lesbar ist */
  amounts: { taxRate: Rate; net: number; tax: number }[] | null;
  categories: { value: string; label: string }[];
  /** Eigene Sachkonten (#270), je Zeile zur Kategorie wählbar */
  ownAccounts?: OwnAccountChoice[];
  /** Gebucht oder während der Auslesung: nur ansehen */
  disabled: boolean;
  onChange: (rows: SplitRowState[]) => void;
  /** Aufteilung aufheben: wieder eine Kategorie für den ganzen Beleg */
  onDissolve: () => void;
  /** Steuer je Zeile: Vorsteuer, bei § 13b (#508) die selbst geschuldete Steuer */
  taxLabel?: string;
}) {
  const parsed = rows.map((row) => parseEuro(row.net || "0"));
  const lines = parseSplitRows(rows);
  const allocated = lines && amounts ? allocateSplitTax(lines, amounts) : null;
  const rates = [...new Set([...(amounts ?? []).map((a) => a.taxRate), ...rows.map((r) => r.taxRate)])].sort((a, b) => b - a);
  // Anlagegüter werden über das Anlagenverzeichnis abgeschrieben und lassen sich nicht aufteilen
  const options = categories.filter((c) => c.value !== "anlage");

  const update = (key: number, patch: Partial<SplitRowState>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <fieldset className="card" style={{ margin: 0 }} disabled={disabled} aria-describedby="split-hint">
      <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Aufteilung auf Kategorien</legend>
      <p id="split-hint" className="small muted" style={{ margin: 0 }}>
        Netto je Zeile; zusammen ergibt jeder Steuersatz das Netto des Belegs. Die {taxLabel} verteilt Haben anteilig, den Rundungscent bekommt die größte
        Zeile.
      </p>
      {rows.map((row, index) => (
        <div className="document-split-row" key={row.key}>
          <Field label="Kategorie">
            {(control) => (
              <select
                {...control}
                value={row.category}
                onChange={(e) =>
                  update(row.key, {
                    category: e.target.value as ExpenseCategory | "",
                    ownAccountId: passendesKonto(ownAccounts, e.target.value, row.ownAccountId),
                  })
                }
                aria-invalid={row.category === ""}
              >
                <option value="">Bitte wählen</option>
                {options.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Satz">
            {(control) => (
              <select {...control} value={row.taxRate} onChange={(e) => update(row.key, { taxRate: Number(e.target.value) as Rate })}>
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                <option value={0}>0 %</option>
              </select>
            )}
          </Field>
          <Field label="Netto" hint={`${taxLabel} ${allocated ? formatDecimal(allocated[index]!.tax) : "–"}`}>
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={row.net}
                placeholder="0,00"
                onChange={(e) => update(row.key, { net: e.target.value })}
                aria-invalid={parsed[index] === null}
              />
            )}
          </Field>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Zeile ${index + 1} der Aufteilung entfernen`}
            disabled={rows.length <= 2}
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <EigenesKontoWahl
            accounts={ownAccounts}
            category={row.category}
            value={row.ownAccountId}
            onChange={(ownAccountId) => update(row.key, { ownAccountId })}
            style={{ gridColumn: "1 / -1" }}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-dashed"
          disabled={rows.length >= 50}
          onClick={() => onChange([...rows, splitRow("", rows.at(-1)?.taxRate ?? 1900, "")])}
        >
          + Zeile
        </button>
        <button type="button" className="btn" onClick={onDissolve}>
          Aufteilung aufheben
        </button>
      </div>
      <ul className="small" aria-live="polite" style={{ margin: 0, paddingLeft: 20 }}>
        {rates.map((rate) => {
          const target = amounts?.find((a) => a.taxRate === rate)?.net ?? 0;
          const sum = rows.reduce((s, row, i) => (row.taxRate === rate ? s + (parsed[i] ?? 0) : s), 0);
          const rest = target - sum;
          return (
            <li key={rate}>
              {percent(rate)}: Zeilen {formatEuro(sum)} von {formatEuro(target)} netto
              {amounts === null ? "" : rest === 0 ? " · stimmt" : rest > 0 ? ` · noch ${formatEuro(rest)} zu verteilen` : ` · ${formatEuro(-rest)} zu viel`}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
