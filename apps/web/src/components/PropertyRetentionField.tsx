import { useId } from "react";

/** Eigener fester Hinweis statt eines Textbausteins, damit er nicht mit dem freien Fußtext verloren geht. */
export function PropertyRetentionField({
  checked,
  onChange,
  inherited = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  inherited?: boolean;
}) {
  const hintId = useId();
  return (
    <div className="checkbox-hinted">
      <label className="checkbox">
        <input type="checkbox" checked={checked} disabled={inherited} onChange={(event) => onChange(event.target.checked)} aria-describedby={hintId} />
        Leistung an einem Grundstück für einen Privatkunden (§ 14 Abs. 4 Nr. 9 UStG)
      </label>
      <span id={hintId} className="field-hint">
        {inherited ? "Aus der ursprünglichen Rechnung übernommen. " : ""}
        Ergänzt den festen Hinweis zur zweijährigen Aufbewahrung unter den Summen im PDF und in der E-Rechnung. Auch bei Kleinunternehmern freiwillig verfügbar.
      </span>
    </div>
  );
}
