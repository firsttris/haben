import {
  ASSET_KINDS,
  ASSET_METHODS,
  CAR_DRIVES,
  formatDecimal,
  formatEuro,
  parseEuro,
  privateUseMonth,
  suggestedPrivateUseRate,
  type AssetKind,
  type AssetMethod,
  type CarDrive,
  type CarPrivateUse,
  type PrivateUseRate,
} from "@haben/core";
import { useState, type FormEvent } from "react";
import { parseUsefulLifeMonths } from "../lib/format.ts";

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
  privateUse: CarPrivateUse | null;
  note: string;
}

const RATE_LABELS: Record<PrivateUseRate, string> = { 100: "1 %", 50: "0,5 %", 25: "0,25 %" };

/**
 * Formular für eine Anlage. `locked` sperrt die Berechnungsgrundlagen (gebucht oder aus einem Beleg),
 * `lifeEditable` erlaubt trotzdem die Nutzungsdauer (Beleg-Anlage vor der ersten AfA).
 */
export function AssetForm({
  initial,
  locked,
  lifeEditable,
  privateUseLocked,
  showOpening,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial: AssetFormValues;
  locked: boolean;
  lifeEditable: boolean;
  /** Privatnutzung gesperrt (schon gebucht) */
  privateUseLocked: boolean;
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
  const [privateUsed, setPrivateUsed] = useState(initial.privateUse !== null);
  const [listPrice, setListPrice] = useState(initial.privateUse ? formatDecimal(initial.privateUse.listPrice) : "");
  const [drive, setDrive] = useState<CarDrive>(initial.privateUse?.drive ?? "elektro");
  const [rate, setRate] = useState<PrivateUseRate>(initial.privateUse?.rate ?? 25);
  const [rateTouched, setRateTouched] = useState(initial.privateUse !== null);
  const [vat, setVat] = useState(initial.privateUse?.vat ?? true);

  const parsedCost = parseEuro(cost);
  const parsedOpening = parseEuro(openingBookValue);
  const lifeMonths = parseUsefulLifeMonths(years);
  const lifeValid = method !== "linear" || lifeMonths !== null;
  const parsedListPrice = parseEuro(listPrice);
  const privateUseValid = kind !== "kfz" || !privateUsed || (parsedListPrice !== null && parsedListPrice > 0);
  // Satz folgt Antrieb, Listenpreis und Anschaffungsdatum, bis er von Hand gewählt wurde (ohne Datum: 1 %)
  const suggestion = suggestedPrivateUseRate(drive, parsedListPrice ?? 0, acquisitionDate);
  const effectiveRate = rateTouched ? rate : suggestion;
  const privateUse: CarPrivateUse | null =
    kind === "kfz" && privateUsed && parsedListPrice ? { listPrice: parsedListPrice, drive, rate: effectiveRate, vat } : null;
  const monthly = privateUse ? privateUseMonth(privateUse) : null;
  const valid =
    privateUseValid &&
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
      usefulLifeMonths: method === "linear" ? lifeMonths : null,
      openingDate,
      openingBookValue: parsedOpening ?? 0,
      disposalDate: disposalDate || null,
      privateUse,
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
        {kind === "kfz" && (
          <fieldset className="stack" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0, gap: 12 }} disabled={privateUseLocked}>
            <label className="checkbox">
              <input type="checkbox" checked={privateUsed} onChange={(e) => setPrivateUsed(e.target.checked)} />
              Auch privat genutzt (Listenpreismethode, ohne Fahrtenbuch)
            </label>
            {privateUsed && (
              <div className="form-grid">
                <label className="field">
                  Bruttolistenpreis (€)
                  <input
                    inputMode="decimal"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    aria-invalid={parsedListPrice === null}
                    aria-describedby="list-price-hint"
                  />
                  <span id="list-price-hint" className="small">
                    Inländischer Listenpreis bei Erstzulassung inklusive Sonderausstattung und Umsatzsteuer, nicht der Kaufpreis.
                  </span>
                </label>
                <label className="field">
                  Antrieb
                  <select value={drive} onChange={(e) => setDrive(e.target.value as CarDrive)}>
                    {Object.entries(CAR_DRIVES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Satz je Monat
                  <select
                    value={effectiveRate}
                    onChange={(e) => {
                      setRate(Number(e.target.value) as PrivateUseRate);
                      setRateTouched(true);
                    }}
                  >
                    {([100, 50, 25] as const).map((r) => (
                      <option key={r} value={r}>
                        {RATE_LABELS[r]}
                        {r === suggestion ? " (Vorschlag)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox" style={{ alignSelf: "end" }}>
                  <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} />
                  Umsatzsteuer auf die Privatnutzung
                </label>
                {monthly && (
                  <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
                    Je Monat {formatEuro(monthly.withdrawal)} Entnahme
                    {monthly.vat ? `, Umsatzsteuer ${formatEuro(monthly.vat)} auf ${formatEuro(monthly.vatBase)} (1 % des Listenpreises abzüglich 20 %)` : ""}.
                    Die Umsatzsteuer kommt in die Voranmeldung, gebucht wird mit der AfA zum Jahresende. Ohne Vorsteuerabzug beim Kauf oder als
                    Kleinunternehmer fällt keine Umsatzsteuer an.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}
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
