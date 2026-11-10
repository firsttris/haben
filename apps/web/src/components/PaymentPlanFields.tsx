import {
  formatDecimal,
  formatEuro,
  formatPercent,
  parseEuro,
  parsePercent,
  planProblem,
  planSchedule,
  type OrderRateAmount,
  type PaymentPlanRow,
  type PlanTemplate,
  type PriceMode,
} from "@haben/core";
import { Field } from "./Field.tsx";

/** Zeile im Formular: Anteil als Text, damit Zwischenstände wie „30,“ stehen bleiben */
export interface PlanRowState {
  key: number;
  label: string;
  kind: "prozent" | "betrag" | "rest";
  value: string;
  due: string;
}

let nextKey = 1;

export function toPlanRows(rows: PaymentPlanRow[]): PlanRowState[] {
  return rows.map((row) => ({
    key: nextKey++,
    label: row.label,
    kind: row.share.kind,
    value: row.share.kind === "prozent" ? formatPercent(row.share.value).replace(" %", "") : row.share.kind === "betrag" ? formatDecimal(row.share.value) : "",
    due: row.due,
  }));
}

/** Formularzeilen → Plan; valid = jeder Anteil lesbar und größer als 0 */
export function parsePlanRows(rows: PlanRowState[]): { rows: PaymentPlanRow[]; valid: boolean } {
  let valid = true;
  const parsed = rows.map((row): PaymentPlanRow => {
    const base = { label: row.label.trim(), due: row.due.trim() };
    if (row.kind === "rest") return { ...base, share: { kind: "rest" } };
    const value = row.kind === "prozent" ? parsePercent(row.value) : parseEuro(row.value);
    if (value === null || value <= 0 || (row.kind === "prozent" && value > 10_000)) valid = false;
    return { ...base, share: row.kind === "prozent" ? { kind: "prozent", value: value ?? 0 } : { kind: "betrag", value: value ?? 0 } };
  });
  return { rows: parsed, valid };
}

/** Neuer Plan ohne Vorlage: Anzahlung und Rest */
const STARTER: PaymentPlanRow[] = [
  { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
  { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
];

/**
 * Zeilen eines Zahlungsplans bearbeiten: Bezeichnung, Prozent oder fester Betrag, Fälligkeit als Text; die letzte Zeile
 * ist immer der Rest. Mit `amounts` (Beträge des Angebots je Satz) zeigt jede Zeile Netto und Brutto.
 */
export function PaymentPlanFields({
  id,
  rows,
  onChange,
  templates = [],
  amounts = null,
  priceMode = "netto",
  taxed = true,
}: {
  id: string;
  rows: PlanRowState[];
  onChange: (rows: PlanRowState[]) => void;
  templates?: PlanTemplate[];
  amounts?: OrderRateAmount[] | null;
  priceMode?: PriceMode;
  /** Mit Steuerausweis: Netto und Brutto, sonst ein Betrag */
  taxed?: boolean;
}) {
  const parsed = parsePlanRows(rows);
  const total = amounts?.reduce((s, a) => s + a.amount, 0) ?? null;
  const problem = !parsed.valid
    ? "Je Zeile einen Anteil angeben, z. B. 30 (Prozent) oder 2.000,00 (Betrag)."
    : total !== null
      ? planProblem(parsed.rows, total)
      : null;
  const schedule = amounts && parsed.valid && !problem && rows.length > 0 ? planSchedule(parsed.rows, amounts, priceMode) : null;
  const update = (key: number, patch: Partial<PlanRowState>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const row: PlanRowState = { key: nextKey++, label: "Abschlag", kind: "prozent", value: "", due: "" };
    onChange([...rows.slice(0, -1), row, ...rows.slice(-1)]);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {templates.length > 0 && (
        <Field label="Vorlage übernehmen">
          {(control) => (
            <select
              {...control}
              value=""
              onChange={(e) => {
                const template = templates.find((t) => t.name === e.target.value);
                if (template) onChange(toPlanRows(template.rows));
              }}
            >
              <option value="">Vorlage wählen …</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {rows.length === 0 ? (
        <div className="actions">
          <button type="button" className="btn btn-dashed" onClick={() => onChange(toPlanRows(STARTER))}>
            + Zahlungsplan anlegen
          </button>
        </div>
      ) : (
        <>
          {rows.map((row, index) => {
            const rest = index === rows.length - 1;
            const scheduled = schedule?.[index];
            const n = index + 1;
            return (
              <fieldset key={row.key} className="plan-row">
                <legend className="visually-hidden">Zahlung {n}</legend>
                <Field label="Bezeichnung">
                  {(control) => (
                    <input
                      {...control}
                      value={row.label}
                      maxLength={100}
                      onChange={(e) => update(row.key, { label: e.target.value })}
                      aria-invalid={!row.label.trim()}
                    />
                  )}
                </Field>
                {/* Ein Feldname für den Wert; die Auswahl „%“ oder „€“ daneben hat ihren eigenen aria-label */}
                <Field label="Anteil" describedBy={rest ? `${id}-rest` : undefined}>
                  {(control) =>
                    rest ? (
                      <input {...control} value="Rest" readOnly />
                    ) : (
                      <span className="plan-share">
                        <input
                          {...control}
                          className="mono"
                          inputMode="decimal"
                          value={row.value}
                          aria-label={`Anteil Zahlung ${n} in ${row.kind === "prozent" ? "Prozent" : "Euro"}`}
                          onChange={(e) => update(row.key, { value: e.target.value })}
                        />
                        <select
                          aria-label={`Art des Anteils Zahlung ${n}`}
                          value={row.kind}
                          onChange={(e) => update(row.key, { kind: e.target.value as "prozent" | "betrag" })}
                        >
                          <option value="prozent">%</option>
                          <option value="betrag">€ {priceMode}</option>
                        </select>
                      </span>
                    )
                  }
                </Field>
                <Field label="Fällig bei">
                  {(control) => (
                    <input
                      {...control}
                      value={row.due}
                      maxLength={100}
                      placeholder="z. B. Lieferung"
                      onChange={(e) => update(row.key, { due: e.target.value })}
                    />
                  )}
                </Field>
                <div className="plan-amount small">
                  {scheduled ? (taxed ? `${formatEuro(scheduled.net)} netto · ${formatEuro(scheduled.gross)} brutto` : formatEuro(scheduled.gross)) : ""}
                </div>
                {!rest && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Zahlung ${n} entfernen`}
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </fieldset>
            );
          })}
          <span id={`${id}-rest`} className="small muted">
            Die letzte Zahlung ist der Rest; ihn rechnet die Schlussrechnung ab. Feste Beträge gelten {priceMode === "brutto" ? "brutto" : "netto"} wie die
            Preise.
          </span>
          {problem && (
            <span className="field-error" role="alert">
              {problem}
            </span>
          )}
          <div className="actions">
            <button type="button" className="btn btn-dashed" onClick={addRow} disabled={rows.length >= 12}>
              + Zahlung hinzufügen
            </button>
            <button type="button" className="btn" onClick={() => onChange([])}>
              Zahlungsplan entfernen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
