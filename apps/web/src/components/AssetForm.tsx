import { ASSET_KINDS, ASSET_METHODS, formatDecimal, parseEuro, type AssetKind, type AssetMethod } from "@haben/core";
import { useState, type FormEvent } from "react";

export interface AssetFormValues {
  name: string;
  kind: AssetKind;
  method: AssetMethod;
  acquisitionDate: string;
  cost: number;
  usefulLifeMonths: number | null;
  openingDate: string;
  openingBookValue: number;
  disposalDate: string | null;
  note: string;
}

/**
 * Formular für eine Anlage. `locked` sperrt die Berechnungsgrundlagen (gebucht oder aus einem Beleg),
 * `lifeEditable` erlaubt trotzdem die Nutzungsdauer (Beleg-Anlage vor der ersten AfA).
 */
export function AssetForm({
  initial,
  locked,
  lifeEditable,
  showOpening,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial: AssetFormValues;
  locked: boolean;
  lifeEditable: boolean;
  showOpening: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: AssetFormValues) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<AssetKind>(initial.kind);
  const [method, setMethod] = useState<AssetMethod>(initial.method);
  const [acquisitionDate, setAcquisitionDate] = useState(initial.acquisitionDate);
  const [cost, setCost] = useState(initial.cost ? formatDecimal(initial.cost) : "");
  const [years, setYears] = useState(initial.usefulLifeMonths ? String(initial.usefulLifeMonths / 12) : "");
  const [openingDate, setOpeningDate] = useState(initial.openingDate);
  const [openingBookValue, setOpeningBookValue] = useState(initial.openingDate ? formatDecimal(initial.openingBookValue) : "");
  const [disposalDate, setDisposalDate] = useState(initial.disposalDate ?? "");
  const [note, setNote] = useState(initial.note);

  const parsedCost = parseEuro(cost);
  const parsedOpening = parseEuro(openingBookValue);
  const parsedYears = Number(years.replace(",", "."));
  const lifeValid = method !== "linear" || (Number.isFinite(parsedYears) && parsedYears > 0 && Number.isInteger(parsedYears * 12));
  const valid =
    name.trim() !== "" &&
    Boolean(acquisitionDate) &&
    parsedCost !== null &&
    parsedCost > 0 &&
    lifeValid &&
    (!showOpening || (Boolean(openingDate) && parsedOpening !== null && parsedOpening >= 0));

  function chooseKind(value: AssetKind) {
    setKind(value);
    // Vorschlag laut AfA-Tabelle
    const suggestion = ASSET_KINDS[value];
    setMethod(suggestion.method);
    if (suggestion.usefulLifeYears && suggestion.method === "linear") setYears(String(suggestion.usefulLifeYears));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      kind,
      method,
      acquisitionDate,
      cost: parsedCost!,
      usefulLifeMonths: method === "linear" ? Math.round(parsedYears * 12) : null,
      openingDate,
      openingBookValue: parsedOpening ?? 0,
      disposalDate: disposalDate || null,
      note,
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Bezeichnung
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="z. B. VW Passat, Kennzeichen R-AB 123" />
        </label>
        <label className="field">
          Art
          <select value={kind} onChange={(e) => chooseKind(e.target.value as AssetKind)} disabled={locked}>
            {Object.entries(ASSET_KINDS).map(([value, k]) => (
              <option key={value} value={value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Abschreibung
          <select value={method} onChange={(e) => setMethod(e.target.value as AssetMethod)} disabled={locked}>
            {Object.entries(ASSET_METHODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Anschaffungsdatum
          <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} disabled={locked} required />
        </label>
        <label className="field">
          Anschaffungskosten netto (€)
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={locked} aria-invalid={parsedCost === null} />
        </label>
        {method === "linear" && (
          <label className="field">
            Nutzungsdauer in Jahren
            <input
              inputMode="decimal"
              value={years}
              onChange={(e) => setYears(e.target.value)}
              disabled={locked && !lifeEditable}
              aria-invalid={!lifeValid}
              aria-describedby="life-hint"
            />
            <span id="life-hint" className="small">
              Laut AfA-Tabelle z. B. Pkw 6, Büromöbel 13 Jahre.
            </span>
          </label>
        )}
        {showOpening && (
          <>
            <label className="field">
              Übernahmestichtag
              <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} disabled={locked} required aria-describedby="opening-hint" />
            </label>
            <label className="field">
              Restbuchwert zum Stichtag (€)
              <input
                inputMode="decimal"
                value={openingBookValue}
                onChange={(e) => setOpeningBookValue(e.target.value)}
                disabled={locked}
                aria-invalid={parsedOpening === null}
                aria-describedby="opening-hint"
              />
            </label>
            <p id="opening-hint" className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Aus dem Anlagenverzeichnis der bisherigen Buchhaltung, z. B. Buchwert zum 31.12. des Vorjahres und Stichtag 01.01. Haben
              schreibt ab dem Stichtag über die restliche Nutzungsdauer ab.
            </p>
          </>
        )}
        <label className="field">
          Abgang (Verkauf, Entnahme, Verschrottung)
          <input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} aria-describedby="disposal-hint" />
          <span id="disposal-hint" className="small">
            Bis zum Abgangsmonat wird abgeschrieben, der Rest geht als Restbuchwert in die Ausgaben. Einen Verkauf stellst du als Rechnung.
          </span>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Notiz
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
