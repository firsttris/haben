import { allowsMemoValue, type AssetMethod, formatDegressiveRate, maxDegressiveRate } from "@haben/core";
import { Field } from "./Field.tsx";

/** Degressiver Satz aus der Eingabe in Prozent („25“, „23,07“) als Basispunkte; leer = Höchstsatz, NaN = ungültig */
export function parseRatePercent(text: string): number | null {
  const value = text.replace("%", "").trim();
  if (!value) return null;
  const match = /^(\d{1,2})(?:[,.](\d{1,2}))?$/.exec(value);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : Number.NaN;
}

export const ratePercentText = (rate: number | null) => (rate === null ? "" : formatDegressiveRate(rate).replace(" %", ""));

/**
 * Angaben zur degressiven AfA (§ 7 Abs. 2 und 3 EStG) und zum Erinnerungswert. Der Wechsel zur linearen AfA bleibt
 * nach der ersten Buchung für spätere Jahre änderbar (`switchEditable`), Satz und Erinnerungswert nicht.
 */
export function AssetMethodOptions({
  method,
  acquisitionDate,
  lifeMonths,
  rate,
  onRate,
  linearFrom,
  onLinearFrom,
  memo,
  onMemo,
  locked,
  switchEditable,
  rateError,
  linearFromError,
}: {
  method: AssetMethod;
  acquisitionDate: string;
  lifeMonths: number | null;
  rate: string;
  onRate: (value: string) => void;
  linearFrom: string;
  onLinearFrom: (value: string) => void;
  memo: boolean;
  onMemo: (value: boolean) => void;
  locked: boolean;
  switchEditable: boolean;
  /** Fehler aus der Prüfung beim Speichern (useSubmitCheck) */
  rateError?: string | undefined;
  linearFromError?: string | undefined;
}) {
  const max = acquisitionDate && lifeMonths ? maxDegressiveRate(acquisitionDate, lifeMonths) : null;
  return (
    <>
      {method === "degressiv" && (
        <>
          <div className="form-row cols-2">
            <Field label="Satz der degressiven AfA in %" describedBy="rate-hint" error={rateError}>
              {(control) => (
                <input
                  {...control}
                  inputMode="decimal"
                  value={rate}
                  placeholder={max ? ratePercentText(max) : ""}
                  onChange={(e) => onRate(e.target.value)}
                  disabled={locked}
                />
              )}
            </Field>
            <Field label="Linear ab Jahr (optional)" describedBy="rate-hint" error={linearFromError}>
              {(control) => (
                <input {...control} inputMode="numeric" value={linearFrom} onChange={(e) => onLinearFrom(e.target.value)} disabled={!switchEditable} />
              )}
            </Field>
          </div>
          <p id="rate-hint" className="field-hint">
            {max === null
              ? "Degressiv nur bei Anschaffung vom 01.01.2020 bis 31.12.2022, 01.04.2024 bis 31.12.2024 und 01.07.2025 bis 31.12.2027."
              : `Höchstens ${formatDegressiveRate(max)}; leer lassen für den Höchstsatz.`}{" "}
            Haben wechselt von selbst zur linearen AfA, sobald sie höher ist. Ein früherer Wechsel geht in ein Jahr, für das noch keine AfA gebucht ist; zurück
            geht es nicht.
          </p>
        </>
      )}
      {method === "elektro" && (
        <p className="field-hint">
          Nur für reine Elektrofahrzeuge, angeschafft vom 01.07.2025 bis 31.12.2027: 75 % im Anschaffungsjahr unabhängig vom Monat, danach 10, 5, 5, 3 und 2 %.
        </p>
      )}
      {allowsMemoValue(method) && (
        <label className="checkbox">
          <input type="checkbox" checked={memo} onChange={(e) => onMemo(e.target.checked)} disabled={locked} />
          Erinnerungswert 1 € bis zum Abgang stehen lassen
        </label>
      )}
    </>
  );
}
