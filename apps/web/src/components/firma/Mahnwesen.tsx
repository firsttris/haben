import { baseRateError, dunningFeeError, formatRateMonth } from "@haben/core";
import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { BaseRateLookup } from "../BaseRateLookup.tsx";
import { Field } from "../Field.tsx";
import { EinklappAbschnitt } from "./EinklappAbschnitt.tsx";
import { type Mahngebuehren, mahnwesenKurz } from "./kurzwerte.ts";

type Firma = Awaited<ReturnType<typeof loadCompany>>;
const STUFEN = [
  ["1", "Gebühr Zahlungserinnerung (€)"],
  ["2", "Gebühr 1. Mahnung (€)"],
  ["3", "Gebühr letzte Mahnung (€)"],
] as const;

/** Fehler der Felder im Abschnitt Mahnwesen, für useSubmitCheck */
export const dunningErrors = (baseRate: string, fees: Mahngebuehren) => ({
  "dunning-baseRate": baseRateError(baseRate),
  "dunning-fee-1": dunningFeeError(fees["1"]),
  "dunning-fee-2": dunningFeeError(fees["2"]),
  "dunning-fee-3": dunningFeeError(fees["3"]),
});

export function Mahnwesen({
  company,
  baseRate,
  onBaseRate,
  fees,
  onFees,
  error,
  offen,
  onOffen,
}: {
  company: Firma;
  baseRate: string;
  onBaseRate: (text: string) => void;
  fees: Mahngebuehren;
  onFees: (fees: Mahngebuehren) => void;
  error: (name: keyof ReturnType<typeof dunningErrors>) => string | undefined;
  offen: boolean;
  onOffen: (offen: boolean) => void;
}) {
  return (
    <EinklappAbschnitt id="company-dunning" titel="Mahnwesen" kurz={mahnwesenKurz(baseRate, fees)} offen={offen} onOffen={onOffen}>
      <div className="form-row cols-2">
        <Field label="Basiszinssatz in %" describedBy="base-rate-hint" error={error("dunning-baseRate")}>
          {(control) => (
            <input
              {...control}
              name="dunning-baseRate"
              inputMode="decimal"
              value={baseRate}
              onChange={(event) => onBaseRate(event.target.value)}
              placeholder="z. B. 1,27"
            />
          )}
        </Field>
        <Field label="Zahlungsfrist in Mahnungen (Tage)">
          {(control) => <input {...control} name="dunning-deadlineDays" inputMode="numeric" defaultValue={company.dunning.deadlineDays} />}
        </Field>
      </div>
      <p id="base-rate-hint" className="field-hint">
        Der Basiszinssatz ändert sich zum 1. Januar und 1. Juli, veröffentlicht von der Deutschen Bundesbank. Der Knopf fragt den aktuellen Satz dort ab und
        trägt ihn ein. Leer = keine Verzugszinsen.
      </p>
      <BaseRateLookup onFound={onBaseRate} />
      <div className="checkbox-hinted">
        <label className="checkbox">
          <input type="checkbox" name="dunning-autoBaseRate" defaultChecked={company.dunning.autoBaseRate === true} aria-describedby="auto-base-rate-hint" />
          <span>Basiszinssatz automatisch abrufen</span>
        </label>
        <span id="auto-base-rate-hint" className="field-hint">
          Haben fragt die Bundesbank nur nach dem 1. Januar und 1. Juli, einmal am Tag, bis der neue Satz veröffentlicht ist, und trägt ihn dann ein. Dazwischen
          ändert sich der Satz nicht und Haben fragt nicht.
          {company.dunning.baseRateSince ? ` Zuletzt bestätigt für das Halbjahr ab ${formatRateMonth(company.dunning.baseRateSince)}.` : ""}
        </span>
      </div>
      <div className="form-row cols-3">
        {STUFEN.map(([stufe, label]) => (
          <Field key={stufe} label={label} error={error(`dunning-fee-${stufe}`)}>
            {(control) => (
              <input
                {...control}
                name={`dunning-fee-${stufe}`}
                inputMode="decimal"
                value={fees[stufe]}
                onChange={(event) => onFees({ ...fees, [stufe]: event.target.value })}
                placeholder="0,00"
              />
            )}
          </Field>
        ))}
      </div>
    </EinklappAbschnitt>
  );
}
