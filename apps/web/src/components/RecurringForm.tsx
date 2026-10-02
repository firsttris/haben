import {
  fillPlaceholders,
  formatDecimal,
  formatEuro,
  formatQuantity,
  lineNet,
  parseEuro,
  parseQuantity,
  RECURRING_INTERVALS,
  RECURRING_PLACEHOLDERS,
  SERVICE_PERIOD_MODES,
  servicePeriodFor,
  TAX_TREATMENTS,
  UNITS,
  type RecurringInterval,
  type ServicePeriodMode,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { useState, type FormEvent } from "react";
import { formatDate } from "../lib/format.ts";

type Rate = 1900 | 700 | 0;
type Format = "zugferd" | "xrechnung-cii" | "xrechnung-ubl";

export interface RecurringValues {
  name: string;
  active: boolean;
  contactId: string;
  format: Format;
  paymentTermDays: number;
  note: string;
  taxTreatment: TaxTreatment;
  exemptionReason: string;
  lines: { description: string; quantity: number; unit: UnitLabel; unitPrice: number; taxRate: Rate }[];
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  servicePeriod: ServicePeriodMode;
  mode: "entwurf" | "festschreiben";
}

interface LineState {
  key: number;
  description: string;
  quantity: string;
  unit: UnitLabel;
  unitPrice: string;
  taxRate: Rate;
}

let nextKey = 1;

const FORMATS: { value: Format; label: string }[] = [
  { value: "zugferd", label: "ZUGFeRD · EN 16931 (PDF mit XML)" },
  { value: "xrechnung-cii", label: "XRechnung 3.0 (CII)" },
  { value: "xrechnung-ubl", label: "XRechnung 3.0 (UBL)" },
];

/** Formular für eine Vorlage; Platzhalter wie {monat} werden in der Vorschau ersetzt */
export function RecurringForm({
  initial,
  contacts,
  kleinunternehmer,
  busy,
  submitLabel,
  onSubmit,
}: {
  initial: RecurringValues;
  contacts: { id: string; name: string; ort: string }[];
  kleinunternehmer: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: RecurringValues) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [active, setActive] = useState(initial.active);
  const [contactId, setContactId] = useState(initial.contactId);
  const [format, setFormat] = useState(initial.format);
  const [paymentTermDays, setPaymentTermDays] = useState(String(initial.paymentTermDays));
  const [note, setNote] = useState(initial.note);
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(initial.taxTreatment);
  const [exemptionReason, setExemptionReason] = useState(initial.exemptionReason);
  const [intervalMonths, setIntervalMonths] = useState<RecurringInterval>(initial.intervalMonths);
  const [nextDate, setNextDate] = useState(initial.nextDate);
  const [endDate, setEndDate] = useState(initial.endDate ?? "");
  const [servicePeriod, setServicePeriod] = useState<ServicePeriodMode>(initial.servicePeriod);
  const [mode, setMode] = useState(initial.mode);
  const [lines, setLines] = useState<LineState[]>(() =>
    initial.lines.map((line) => ({
      key: nextKey++,
      description: line.description,
      quantity: formatQuantity(line.quantity),
      unit: line.unit,
      unitPrice: line.unitPrice ? formatDecimal(line.unitPrice) : "",
      taxRate: line.taxRate,
    })),
  );

  const special = taxTreatment !== "regulaer";
  const parsed = lines.map((line) => {
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parseEuro(line.unitPrice);
    return {
      description: line.description.trim(),
      quantity: quantity ?? 0,
      unit: line.unit,
      unitPrice: unitPrice ?? 0,
      taxRate: special ? (0 as Rate) : line.taxRate,
      valid: quantity !== null && quantity > 0 && unitPrice !== null && line.description.trim() !== "",
    };
  });
  const term = Number(paymentTermDays);
  const valid =
    name.trim() !== "" &&
    contactId !== "" &&
    Boolean(nextDate) &&
    Number.isInteger(term) &&
    term >= 0 &&
    term <= 120 &&
    parsed.length > 0 &&
    parsed.every((l) => l.valid) &&
    (!endDate || endDate >= nextDate) &&
    (taxTreatment !== "steuerfrei" || exemptionReason.trim() !== "");

  const period = nextDate ? servicePeriodFor(nextDate, intervalMonths, servicePeriod) : null;
  const reference = period ?? (nextDate ? { from: nextDate, to: nextDate } : null);
  const net = parsed.reduce((s, l) => s + (l.valid ? lineNet(l.quantity, l.unitPrice) : 0), 0);

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      active,
      contactId,
      format,
      paymentTermDays: term,
      note,
      taxTreatment,
      exemptionReason: special ? exemptionReason : "",
      lines: parsed.map(({ valid: _valid, ...line }) => line),
      intervalMonths,
      nextDate,
      endDate: endDate || null,
      servicePeriod,
      mode,
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <section className="card stack" aria-label="Vorlage">
        <div className="form-grid">
          <label className="field">
            Bezeichnung
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="z. B. Wartungsvertrag Nordwerk" required />
          </label>
          <label className="field">
            Kunde
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} required>
              <option value="">Bitte wählen</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.ort ? ` · ${c.ort}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Intervall
            <select value={intervalMonths} onChange={(e) => setIntervalMonths(Number(e.target.value) as RecurringInterval)}>
              {Object.entries(RECURRING_INTERVALS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Nächste Rechnung am
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required aria-describedby="next-hint" />
            <span id="next-hint" className="small">
              Rechnungsdatum. Die folgenden Termine liegen am selben Tag im Monat; der 31. wird zum Monatsende.
            </span>
          </label>
          <label className="field">
            Endet nach dem (optional)
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={Boolean(endDate) && endDate < nextDate} />
          </label>
          <label className="field">
            Leistungszeitraum
            <select value={servicePeriod} onChange={(e) => setServicePeriod(e.target.value as ServicePeriodMode)}>
              {Object.entries(SERVICE_PERIOD_MODES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Zahlungsziel in Tagen
            <input inputMode="numeric" value={paymentTermDays} onChange={(e) => setPaymentTermDays(e.target.value)} />
          </label>
          <label className="field">
            E-Rechnungsformat
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Umsatzsteuer
            <select value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value as TaxTreatment)} disabled={kleinunternehmer}>
              {(Object.keys(TAX_TREATMENTS) as TaxTreatment[])
                .filter((t) => (kleinunternehmer ? t === "kleinunternehmer" : t !== "kleinunternehmer" || taxTreatment === t))
                .map((t) => (
                  <option key={t} value={t}>
                    {TAX_TREATMENTS[t].label}
                  </option>
                ))}
            </select>
          </label>
          {special && (
            <label className="field">
              {taxTreatment === "steuerfrei" ? "Befreiungsvorschrift" : "Hinweis zur Umsatzsteuer (optional)"}
              <input
                value={exemptionReason}
                onChange={(e) => setExemptionReason(e.target.value)}
                maxLength={300}
                placeholder={TAX_TREATMENTS[taxTreatment].note ?? ""}
              />
            </label>
          )}
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend className="small muted" style={{ marginBottom: 4 }}>
            Was am Termin passiert
          </legend>
          <label className="checkbox">
            <input type="radio" name="mode" checked={mode === "entwurf"} onChange={() => setMode("entwurf")} />
            Entwurf anlegen; ich prüfe und schreibe selbst fest
          </label>
          <label className="checkbox">
            <input type="radio" name="mode" checked={mode === "festschreiben"} onChange={() => setMode("festschreiben")} />
            Direkt festschreiben (Nummer, PDF und XML, gebucht)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktiv
          </label>
        </fieldset>
      </section>

      <section className="card" aria-labelledby="recurring-lines">
        <h2 id="recurring-lines">Positionen</h2>
        <div className="line-row head" aria-hidden="true">
          <div>Menge</div>
          <div>Einheit</div>
          <div>Einzelpreis</div>
          <div>USt</div>
          <div style={{ textAlign: "right" }}>Netto</div>
          <div />
        </div>
        {lines.map((line, index) => {
          const p = parsed[index]!;
          return (
            <div className="line-row" key={line.key}>
              <input
                className="line-desc"
                placeholder={`Beschreibung Position ${index + 1}, z. B. Wartung {monat} {jahr}`}
                aria-label={`Beschreibung Position ${index + 1}`}
                value={line.description}
                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                aria-invalid={line.description.trim() === ""}
              />
              <input
                className="num"
                inputMode="decimal"
                aria-label={`Menge Position ${index + 1}`}
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                aria-invalid={parseQuantity(line.quantity) === null}
              />
              <select aria-label={`Einheit Position ${index + 1}`} value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value as UnitLabel })}>
                {Object.keys(UNITS).map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
              <input
                className="num"
                inputMode="decimal"
                aria-label={`Einzelpreis Position ${index + 1} in Euro`}
                value={line.unitPrice}
                placeholder="0,00"
                onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                aria-invalid={parseEuro(line.unitPrice) === null}
              />
              <select
                aria-label={`Steuersatz Position ${index + 1}`}
                value={special ? 0 : line.taxRate}
                disabled={special}
                onChange={(e) => updateLine(line.key, { taxRate: Number(e.target.value) as Rate })}
              >
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                <option value={0}>0 %</option>
              </select>
              <div className="num line-net">{p.valid ? formatEuro(lineNet(p.quantity, p.unitPrice)) : "–"}</div>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Position ${index + 1} entfernen`}
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="actions">
          <button
            type="button"
            className="btn btn-dashed"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { key: nextKey++, description: "", quantity: "1", unit: prev.at(-1)?.unit ?? "Psch.", unitPrice: "", taxRate: prev.at(-1)?.taxRate ?? 1900 },
              ])
            }
          >
            + Position hinzufügen
          </button>
        </div>
        <label className="field">
          Hinweis auf der Rechnung (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          Platzhalter in Beschreibung und Hinweis:{" "}
          {Object.entries(RECURRING_PLACEHOLDERS)
            .map(([key, label]) => `${key} (${label})`)
            .join(", ")}
          . Sie beziehen sich auf den Leistungszeitraum, ohne Leistungszeitraum auf das Rechnungsdatum.
        </p>
      </section>

      {reference && (
        <section className="card stack" aria-label="Vorschau">
          <h2>Nächste Rechnung</h2>
          <p className="small" style={{ margin: 0 }}>
            Am {formatDate(nextDate)}
            {period ? `, Leistungszeitraum ${formatDate(period.from)} – ${formatDate(period.to)}` : ""}, netto {formatEuro(net)}
          </p>
          <ul className="small" style={{ margin: 0 }}>
            {parsed
              .filter((l) => l.description)
              .map((l, i) => (
                <li key={i}>{fillPlaceholders(l.description, reference)}</li>
              ))}
          </ul>
        </section>
      )}

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
