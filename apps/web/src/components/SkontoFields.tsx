import { formatDecimal, MAX_SKONTO_STUFEN, parsePercent, type SkontoStufe } from "@haben/core";
import { Icon } from "./Icon.tsx";
import { Field } from "./Field.tsx";

/** Eine Skontostufe im Formular, wie eingegeben */
export interface SkontoRow {
  key: number;
  percent: string;
  days: string;
}

let nextKey = 1;

export function toSkontoRows(stufen: readonly SkontoStufe[]): SkontoRow[] {
  return stufen.map((s) => ({ key: nextKey++, percent: formatDecimal(s.percent).replace(/,00$/, ""), days: String(s.days) }));
}

function parseRow(row: SkontoRow): SkontoStufe | null {
  const percent = parsePercent(row.percent);
  const days = /^\d{1,3}$/.test(row.days.trim()) ? Number(row.days) : null;
  return percent !== null && percent > 0 && percent < 10_000 && days !== null && days > 0 ? { days, percent } : null;
}

/** Stufen aus dem Formular; ganz leere Zeilen zählen nicht, eine halb ausgefüllte macht das Ganze ungültig */
export function parseSkontoRows(rows: readonly SkontoRow[]): { stufen: SkontoStufe[]; valid: boolean } {
  const filled = rows.filter((r) => r.percent.trim() !== "" || r.days.trim() !== "");
  const stufen = filled.map(parseRow);
  return { stufen: stufen.filter((s): s is SkontoStufe => s !== null), valid: stufen.every((s) => s !== null) };
}

/**
 * Skontostufen mit Satz und Frist, für Firmendaten, Kontakt und Rechnung. `describe` ergänzt je gültiger Stufe einen
 * Hinweis, etwa Datum und Betrag auf der Rechnung; `problem` steht unter allen Stufen.
 */
export function SkontoFields({
  id,
  rows,
  onChange,
  disabled = false,
  hint,
  problem = null,
  describe,
}: {
  id: string;
  rows: SkontoRow[];
  onChange: (rows: SkontoRow[]) => void;
  disabled?: boolean;
  hint?: string;
  problem?: string | null;
  describe?: (stufe: SkontoStufe) => string | null;
}) {
  const update = (key: number, patch: Partial<SkontoRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const describedBy = [hint ? `${id}-hint` : null, problem ? `${id}-problem` : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8, gridColumn: "1 / -1" }} aria-describedby={describedBy}>
      <legend style={{ padding: 0, fontWeight: 600 }}>Skonto</legend>
      {rows.map((row, index) => {
        const stufe = parseRow(row);
        const filled = row.percent.trim() !== "" || row.days.trim() !== "";
        const detail = stufe && describe ? describe(stufe) : null;
        return (
          <div key={row.key} className="stack" style={{ gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label={<>Stufe {index + 1}: Skonto in %</>} style={{ flex: "1 1 120px" }}>
                {(control) => (
                  <input
                    {...control}
                    inputMode="decimal"
                    value={row.percent}
                    placeholder="z. B. 2"
                    onChange={(e) => update(row.key, { percent: e.target.value })}
                    aria-invalid={filled && parsePercent(row.percent) === null}
                    disabled={disabled}
                  />
                )}
              </Field>
              <Field label={<>Stufe {index + 1}: Frist in Tagen</>} style={{ flex: "1 1 120px" }}>
                {(control) => (
                  <input
                    {...control}
                    inputMode="numeric"
                    value={row.days}
                    placeholder="z. B. 10"
                    onChange={(e) => update(row.key, { days: e.target.value })}
                    aria-invalid={filled && !/^\d{1,3}$/.test(row.days.trim())}
                    disabled={disabled}
                  />
                )}
              </Field>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Skontostufe ${index + 1} entfernen`}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                disabled={disabled}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {detail && <span className="small muted">{detail}</span>}
          </div>
        );
      })}
      {rows.length < MAX_SKONTO_STUFEN && (
        <div>
          <button type="button" className="btn" onClick={() => onChange([...rows, { key: nextKey++, percent: "", days: "" }])} disabled={disabled}>
            <Icon name="plus" size={16} /> Skontostufe hinzufügen
          </button>
        </div>
      )}
      {hint && (
        <span id={`${id}-hint`} className="small">
          {hint}
        </span>
      )}
      {problem && (
        <span id={`${id}-problem`} className="small" role="alert" style={{ color: "var(--danger-ink)" }}>
          {problem}
        </span>
      )}
    </fieldset>
  );
}
