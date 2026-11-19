import {
  ASSET_KINDS,
  ASSET_METHODS,
  type AssetKind,
  type AssetMethod,
  usesUsefulLife,
  CAR_DRIVES,
  type CarDrive,
  formatEuro,
  type PrivateUseRate,
  type privateUseMonth,
} from "@haben/core";
import { AssetMethodOptions, hasMethodHint } from "./AssetMethodOptions.tsx";
import { Field } from "./Field.tsx";
import type { AssetErrorKey, AssetState } from "./asset-form-lesen.ts";

/* Abschnitte des Formulars für eine Anlage (AssetForm.tsx) */

type TeilProps = { v: AssetState; set: (patch: Partial<AssetState>) => void; error: (key: AssetErrorKey) => string | undefined };

// Schlüssel als Literale: PrivateUseRate trägt die Einheit Basispunkte und taugt deshalb nicht als Schlüssel eines Record
const RATE_LABELS: Record<100 | 50 | 25, string> = { 100: "1 %", 50: "0,5 %", 25: "0,25 %" };

export function AssetBasics({ v, set, chooseKind, locked, error }: TeilProps & { chooseKind: (kind: AssetKind) => void; locked: boolean }) {
  return (
    <section className="form-section" aria-labelledby="asset-basics">
      <h3 id="asset-basics">Anlage</h3>
      <Field label="Bezeichnung" error={error("name")}>
        {(control) => (
          <input
            {...control}
            value={v.name}
            onChange={(e) => set({ name: e.target.value })}
            required
            maxLength={200}
            placeholder="z. B. VW Passat, Kennzeichen R-AB 123"
          />
        )}
      </Field>
      <div className="form-row cols-2">
        <Field label="Art">
          {(control) => (
            <select {...control} value={v.kind} onChange={(e) => chooseKind(e.target.value as AssetKind)} disabled={locked}>
              {Object.entries(ASSET_KINDS).map(([value, k]) => (
                <option key={value} value={value}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Anschaffungsdatum" error={error("acquisitionDate")}>
          {(control) => (
            <input {...control} type="date" value={v.acquisitionDate} onChange={(e) => set({ acquisitionDate: e.target.value })} disabled={locked} required />
          )}
        </Field>
      </div>
      <Field label="Anschaffungskosten netto (€)" error={error("cost")}>
        {(control) => <input {...control} inputMode="decimal" value={v.cost} onChange={(e) => set({ cost: e.target.value })} disabled={locked} />}
      </Field>
    </section>
  );
}

export function AssetOpening({ v, set, locked, error }: TeilProps & { locked: boolean }) {
  return (
    <>
      <div className="form-row cols-2">
        <Field label="Übernahmestichtag" describedBy="opening-hint" error={error("openingDate")}>
          {(control) => (
            <input {...control} type="date" value={v.openingDate} onChange={(e) => set({ openingDate: e.target.value })} disabled={locked} required />
          )}
        </Field>
        <Field label="Restbuchwert zum Stichtag (€)" describedBy="opening-hint" error={error("opening")}>
          {(control) => (
            <input {...control} inputMode="decimal" value={v.openingBookValue} onChange={(e) => set({ openingBookValue: e.target.value })} disabled={locked} />
          )}
        </Field>
      </div>
      <p id="opening-hint" className="field-hint">
        Aus dem Anlagenverzeichnis der bisherigen Buchhaltung, z. B. Buchwert zum 31.12. des Vorjahres und Stichtag 01.01. Haben schreibt ab dem Stichtag über
        die restliche Nutzungsdauer ab.
      </p>
    </>
  );
}

/** Privatnutzung eines Fahrzeugs nach der Listenpreismethode */
export function AssetPrivateUse({
  v,
  set,
  locked,
  suggestion,
  effectiveRate,
  monthly,
  error,
}: TeilProps & { locked: boolean; suggestion: PrivateUseRate; effectiveRate: PrivateUseRate; monthly: ReturnType<typeof privateUseMonth> | null }) {
  return (
    <fieldset className="stack" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0, gap: 12 }} disabled={locked}>
      <label className="checkbox">
        <input type="checkbox" checked={v.privateUsed} onChange={(e) => set({ privateUsed: e.target.checked })} />
        Auch privat genutzt (Listenpreismethode, ohne Fahrtenbuch)
      </label>
      {v.privateUsed && (
        <div className="form-grid">
          <Field
            label="Bruttolistenpreis (€)"
            hint="Inländischer Listenpreis bei Erstzulassung inklusive Sonderausstattung und Umsatzsteuer, nicht der Kaufpreis."
            error={error("listPrice")}
          >
            {(control) => <input {...control} inputMode="decimal" value={v.listPrice} onChange={(e) => set({ listPrice: e.target.value })} />}
          </Field>
          <Field label="Antrieb">
            {(control) => (
              <select {...control} value={v.drive} onChange={(e) => set({ drive: e.target.value as CarDrive })}>
                {Object.entries(CAR_DRIVES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Satz je Monat">
            {(control) => (
              <select {...control} value={effectiveRate} onChange={(e) => set({ rate: Number(e.target.value) as PrivateUseRate, rateTouched: true })}>
                {([100, 50, 25] as const).map((r) => (
                  <option key={r} value={r}>
                    {RATE_LABELS[r]}
                    {r === suggestion ? " (Vorschlag)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <label className="checkbox" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={v.vat} onChange={(e) => set({ vat: e.target.checked })} />
            Umsatzsteuer auf die Privatnutzung
          </label>
          {monthly && (
            <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Je Monat {formatEuro(monthly.withdrawal)} Entnahme
              {monthly.vat ? `, Umsatzsteuer ${formatEuro(monthly.vat)} auf ${formatEuro(monthly.vatBase)} (1 % des Listenpreises abzüglich 20 %)` : ""}. Die
              Umsatzsteuer kommt in die Voranmeldung, gebucht wird mit der AfA zum Jahresende. Ohne Vorsteuerabzug beim Kauf oder als Kleinunternehmer fällt
              keine Umsatzsteuer an.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Wählbare Methoden: Elektro nur bei Fahrzeugen im Einzelunternehmen; bei einer Beleg-Anlage (`fromDocument`) nur
 * Methoden auf dem Anlagekonto der Art, GWG und Sammelposten legt die Belegbuchung mit eigenem Konto fest.
 */
function methodChoices(kind: AssetKind, fromDocument: boolean, elektroOffered: boolean): AssetMethod[] {
  const all = Object.keys(ASSET_METHODS) as AssetMethod[];
  return all.filter((m) => (m !== "elektro" || (kind === "kfz" && elektroOffered)) && (!fromDocument || (m !== "gwg" && m !== "sammelposten")));
}

export function AssetDepreciation({
  v,
  set,
  error,
  locked,
  lifeEditable,
  switchEditable,
  elektroOffered,
  showOpening,
  lifeMonths,
}: TeilProps & { locked: boolean; lifeEditable: boolean; switchEditable: boolean; elektroOffered: boolean; showOpening: boolean; lifeMonths: number | null }) {
  // Bei einer Beleg-Anlage vor der ersten AfA bleibt das Anlagekonto: nur Methoden ohne eigenes Konto
  const methodLocked = locked && !lifeEditable;
  return (
    <section className="form-section" aria-labelledby="asset-depreciation">
      <h3 id="asset-depreciation">Abschreibung</h3>
      <p id="asset-depreciation-hint" className="field-hint">
        Die Kosten einer Anlage verteilst du auf mehrere Jahre; nur bei GWG und bei Computern und Software setzt du sie im Jahr des Kaufs ganz ab (Fachwort:
        AfA, Absetzung für Abnutzung).
      </p>
      <div className="form-row cols-2">
        <Field label="Abschreibung" describedBy={hasMethodHint(v.method) ? "asset-depreciation-hint method-hint" : "asset-depreciation-hint"}>
          {(control) => (
            <select {...control} value={v.method} onChange={(e) => set({ method: e.target.value as AssetMethod })} disabled={methodLocked}>
              {Object.entries(ASSET_METHODS)
                .filter(([value]) => value === v.method || methodChoices(v.kind, locked, elektroOffered).includes(value as AssetMethod))
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          )}
        </Field>
        {usesUsefulLife(v.method) && (
          <Field label="Nutzungsdauer in Jahren" describedBy="life-hint" error={error("years")}>
            {(control) => (
              <input {...control} inputMode="decimal" value={v.years} onChange={(e) => set({ years: e.target.value })} disabled={locked && !lifeEditable} />
            )}
          </Field>
        )}
      </div>
      {usesUsefulLife(v.method) && (
        <p id="life-hint" className="field-hint">
          Laut AfA-Tabelle z. B. Pkw 6, Büromöbel 13 Jahre.
        </p>
      )}
      <AssetMethodOptions
        method={v.method}
        acquisitionDate={v.acquisitionDate}
        lifeMonths={lifeMonths}
        rate={v.rateText}
        onRate={(rateText) => set({ rateText })}
        linearFrom={v.linearFrom}
        onLinearFrom={(linearFrom) => set({ linearFrom })}
        memo={v.memoValue}
        onMemo={(memoValue) => set({ memoValue })}
        locked={methodLocked}
        switchEditable={switchEditable}
        rateError={error("rate")}
        linearFromError={error("linearFrom")}
      />
      {showOpening && <AssetOpening v={v} set={set} locked={locked} error={error} />}
    </section>
  );
}
