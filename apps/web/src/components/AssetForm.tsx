import { ASSET_KINDS, type AssetKind, type AssetMethod, type CarPrivateUse } from "@haben/core";
import { useState, type FormEvent } from "react";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { Field } from "./Field.tsx";
import { AssetBasics, AssetDepreciation, AssetPrivateUse } from "./AssetFormTeile.tsx";
import { type AssetState, assetState, readAsset } from "./asset-form-lesen.ts";

export interface AssetFormValues {
  name: string;
  kind: AssetKind;
  method: AssetMethod;
  acquisitionDate: string;
  cost: number;
  usefulLifeMonths: number | null;
  /** Nur degressiv: Basispunkte, null = Höchstsatz */
  degressiveRate: number | null;
  linearFromYear: number | null;
  memoValue: boolean;
  openingDate: string;
  openingBookValue: number;
  disposalDate: string | null;
  privateUse: CarPrivateUse | null;
  note: string;
}

/**
 * Formular für eine Anlage. `locked` sperrt die Berechnungsgrundlagen (gebucht oder aus einem Beleg),
 * `lifeEditable` erlaubt trotzdem Nutzungsdauer, Abschreibung und ihre Angaben (Beleg-Anlage vor der ersten AfA),
 * `switchEditable` den Wechsel von der degressiven zur linearen AfA (auch nach der ersten Buchung).
 */
export function AssetForm({
  initial,
  locked,
  lifeEditable,
  switchEditable,
  privateUseLocked,
  privateUseAvailable,
  elektroOffered,
  showOpening,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial: AssetFormValues;
  locked: boolean;
  lifeEditable: boolean;
  switchEditable: boolean;
  /** Privatnutzung gesperrt (schon gebucht) */
  privateUseLocked: boolean;
  /** Privatnutzung als Entnahme gibt es nur im Einzelunternehmen; in GmbH und UG ist sie Arbeitslohn */
  privateUseAvailable: boolean;
  /** AfA nach § 7 Abs. 2a EStG nur im Einzelunternehmen (elektroAvailable in @haben/core) */
  elektroOffered: boolean;
  showOpening: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: AssetFormValues) => void;
}) {
  const [v, setV] = useState<AssetState>(() => assetState(initial));
  const set = (patch: Partial<AssetState>) => setV((prev) => ({ ...prev, ...patch }));
  const { lifeMonths, suggestion, effectiveRate, monthly, errors, values } = readAsset(v, showOpening);
  const { form, error, check } = useSubmitCheck(errors);

  function chooseKind(kind: AssetKind) {
    // Vorschlag laut AfA-Tabelle
    const suggested = ASSET_KINDS[kind];
    // Ohne Vorschlag (sonstige Ausstattung, sonstige Transportmittel) bleibt keine Nutzungsdauer der vorigen Art stehen,
    // etwa die sechs Jahre für Pkw; sie kommt aus der AfA-Tabelle des einzelnen Wirtschaftsguts (#312)
    const years = suggested.method === "linear" ? { years: suggested.usefulLifeYears ? String(suggested.usefulLifeYears) : "" } : {};
    set({ kind, method: suggested.method, ...years });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!check() || !values) return;
    onSubmit(values);
  }

  return (
    <form ref={form} className="stack plain-sections" onSubmit={submit} noValidate>
      <AssetBasics v={v} set={set} chooseKind={chooseKind} locked={locked} error={error} />
      <AssetDepreciation
        v={v}
        set={set}
        error={error}
        locked={locked}
        lifeEditable={lifeEditable}
        switchEditable={switchEditable}
        elektroOffered={elektroOffered}
        showOpening={showOpening}
        lifeMonths={lifeMonths}
      />
      <section className="form-section" aria-labelledby="asset-disposal">
        <h3 id="asset-disposal">Abgang</h3>
        <div className="form-row cols-2">
          <Field label="Abgang (Verkauf, Entnahme, Verschrottung)" describedBy="disposal-hint">
            {(control) => <input {...control} type="date" value={v.disposalDate} onChange={(e) => set({ disposalDate: e.target.value })} />}
          </Field>
        </div>
        <p id="disposal-hint" className="field-hint">
          Bis zum Abgangsmonat wird abgeschrieben, der Rest geht als Restbuchwert in die Ausgaben. Einen Verkauf stellst du als Rechnung.
        </p>
      </section>

      <div className="form-grid">
        {v.kind === "kfz" && privateUseAvailable && (
          <AssetPrivateUse v={v} set={set} locked={privateUseLocked} suggestion={suggestion} effectiveRate={effectiveRate} monthly={monthly} error={error} />
        )}
      </div>

      <section className="form-section" aria-labelledby="asset-note">
        <h3 id="asset-note">Notiz</h3>
        <Field label="Notiz" hideLabel>
          {(control) => <textarea {...control} value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={2000} />}
        </Field>
      </section>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
