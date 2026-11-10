import {
  fillPlaceholders,
  formatDecimal,
  formatEuro,
  formatQuantity,
  ITEM_NUMBER_MAX,
  lineAmount,
  LINE_DETAIL_MAX,
  parseEuro,
  parseQuantity,
  RECURRING_INTERVALS,
  RECURRING_PLACEHOLDERS,
  SERVICE_PERIOD_MODES,
  servicePeriodFor,
  TAX_TREATMENTS,
  UNITS,
  type PaymentMethod,
  type PriceMode,
  type RecurringInterval,
  type ServicePeriodMode,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { useState, type FormEvent } from "react";
import { formatDate } from "../lib/format.ts";
import { FORMAT_LABEL, FORMATS, type InvoiceFormat } from "../lib/invoice.ts";
import { FormattedText } from "./FormattedText.tsx";
import { FormattedTextarea } from "./FormattedTextarea.tsx";
import { TextBlockField, type TextBlockOption } from "./TextBlockField.tsx";
import { LineAmount, LineCell } from "./LineCell.tsx";
import { Icon } from "./Icon.tsx";
import { Field } from "./Field.tsx";

type Rate = 1900 | 700 | 0;

export interface RecurringValues {
  name: string;
  active: boolean;
  contactId: string;
  format: InvoiceFormat;
  paymentTermDays: number;
  intro: string;
  note: string;
  taxTreatment: TaxTreatment;
  exemptionReason: string;
  priceMode: PriceMode;
  lines: { description: string; detail: string; itemNumber?: string; quantity: number; unit: UnitLabel; unitPrice: number; taxRate: Rate }[];
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  servicePeriod: ServicePeriodMode;
  mode: "entwurf" | "festschreiben";
  sendByMail: boolean;
  /** Überweisung oder Lastschrift (#445); das Mandat wählt jeder Lauf selbst */
  paymentMethod: PaymentMethod;
}

interface LineState {
  key: number;
  description: string;
  /** Mehrzeilige Beschreibung unter der Bezeichnung */
  detail: string;
  /** Artikelnummer (BT-155), geht in jede Rechnung aus der Vorlage */
  itemNumber: string;
  quantity: string;
  unit: UnitLabel;
  unitPrice: string;
  taxRate: Rate;
}

let nextKey = 1;

/** Formular für eine Vorlage; Platzhalter wie {monat} werden in der Vorschau ersetzt */
export function RecurringForm({
  initial,
  contacts,
  textBlocks = [],
  kleinunternehmer,
  busy,
  submitLabel,
  onSubmit,
}: {
  initial: RecurringValues;
  /** Nur Kunden stehen zur Auswahl; der gewählte bleibt sichtbar */
  contacts: { id: string; name: string; ort: string; isCustomer: boolean }[];
  /** Kopf- und Fußtexte zum Einfügen */
  textBlocks?: TextBlockOption[];
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
  const [intro, setIntro] = useState(initial.intro);
  const [note, setNote] = useState(initial.note);
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(initial.taxTreatment);
  const [exemptionReason, setExemptionReason] = useState(initial.exemptionReason);
  const [priceMode, setPriceMode] = useState<PriceMode>(initial.priceMode);
  const [intervalMonths, setIntervalMonths] = useState<RecurringInterval>(initial.intervalMonths);
  const [nextDate, setNextDate] = useState(initial.nextDate);
  const [endDate, setEndDate] = useState(initial.endDate ?? "");
  const [servicePeriod, setServicePeriod] = useState<ServicePeriodMode>(initial.servicePeriod);
  const [mode, setMode] = useState(initial.mode);
  const [sendByMail, setSendByMail] = useState(initial.sendByMail);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial.paymentMethod);
  const [lines, setLines] = useState<LineState[]>(() =>
    initial.lines.map((line) => ({
      key: nextKey++,
      description: line.description,
      detail: line.detail,
      itemNumber: line.itemNumber ?? "",
      quantity: formatQuantity(line.quantity),
      unit: line.unit,
      unitPrice: line.unitPrice ? formatDecimal(line.unitPrice) : "",
      taxRate: line.taxRate,
    })),
  );

  const special = taxTreatment !== "regulaer";
  /** Bruttopreise nur mit Steuerausweis */
  const grossPrices = !special && priceMode === "brutto";
  const amountLabel = grossPrices ? "Brutto" : "Netto";
  const parsed = lines.map((line) => {
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parseEuro(line.unitPrice);
    return {
      description: line.description.trim(),
      detail: line.detail.trim(),
      itemNumber: line.itemNumber.trim(),
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
  const sum = parsed.reduce((s, l) => s + (l.valid ? lineAmount(l.quantity, l.unitPrice) : 0), 0);

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
      intro,
      note,
      taxTreatment,
      exemptionReason: special ? exemptionReason : "",
      priceMode: grossPrices ? "brutto" : "netto",
      lines: parsed.map(({ valid: _valid, ...line }) => line),
      intervalMonths,
      nextDate,
      endDate: endDate || null,
      servicePeriod,
      mode,
      sendByMail: mode === "festschreiben" && sendByMail,
      paymentMethod,
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <section className="card form-card" aria-label="Vorlage">
        <div className="form-section" role="group" aria-labelledby="recurring-basics">
          <h2 id="recurring-basics">Vorlage</h2>
          <div className="form-row cols-2">
            <Field label="Bezeichnung">
              {(control) => (
                <input
                  {...control}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  placeholder="z. B. Wartungsvertrag Nordwerk"
                  required
                />
              )}
            </Field>
            <Field label="Kunde">
              {(control) => (
                <select {...control} value={contactId} onChange={(e) => setContactId(e.target.value)} required>
                  <option value="">Bitte wählen</option>
                  {contacts
                    .filter((c) => c.isCustomer || c.id === contactId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.ort ? ` · ${c.ort}` : ""}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>
        </div>
        <div className="form-section" role="group" aria-labelledby="recurring-dates">
          <h2 id="recurring-dates">Termine</h2>
          <div className="form-row cols-2">
            <Field label="Nächste Rechnung am" describedBy="next-hint">
              {(control) => <input {...control} type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required />}
            </Field>
            <Field label="Intervall">
              {(control) => (
                <select {...control} value={intervalMonths} onChange={(e) => setIntervalMonths(Number(e.target.value) as RecurringInterval)}>
                  {Object.entries(RECURRING_INTERVALS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <p id="next-hint" className="field-hint">
            Rechnungsdatum. Die folgenden Termine liegen am selben Tag im Monat; der 31. wird zum Monatsende.
          </p>
          <div className="form-row cols-2">
            <Field label="Endet nach dem (optional)">
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-invalid={Boolean(endDate) && endDate < nextDate}
                />
              )}
            </Field>
            <Field label="Leistungszeitraum">
              {(control) => (
                <select {...control} value={servicePeriod} onChange={(e) => setServicePeriod(e.target.value as ServicePeriodMode)}>
                  {Object.entries(SERVICE_PERIOD_MODES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </div>
        <div className="form-section" role="group" aria-labelledby="recurring-invoice">
          <h2 id="recurring-invoice">Rechnung</h2>
          <div className="form-row cols-2">
            <Field label="Zahlungsziel in Tagen">
              {(control) => <input {...control} inputMode="numeric" value={paymentTermDays} onChange={(e) => setPaymentTermDays(e.target.value)} />}
            </Field>
            <Field label="E-Rechnungsformat">
              {(control) => (
                <select {...control} value={format} onChange={(e) => setFormat(e.target.value as InvoiceFormat)}>
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABEL[f]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field
            label="Zahlungsart"
            hint={
              paymentMethod === "lastschrift" && (
                <>
                  Jede Rechnung nimmt das jüngste Mandat des Kunden, das am Fälligkeitstag gilt, und kündigt den Einzug an diesem Tag an. Ohne gültiges Mandat
                  entsteht keine Rechnung; der Hinweis steht dann an der Vorlage.
                </>
              )
            }
          >
            {(control) => (
              <select {...control} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value === "lastschrift" ? "lastschrift" : "ueberweisung")}>
                <option value="ueberweisung">Überweisung</option>
                <option value="lastschrift">SEPA-Lastschrift</option>
              </select>
            )}
          </Field>
          <div className="form-row cols-2">
            <Field label="Umsatzsteuer">
              {(control) => (
                <select {...control} value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value as TaxTreatment)} disabled={kleinunternehmer}>
                  {(Object.keys(TAX_TREATMENTS) as TaxTreatment[])
                    .filter((t) => (kleinunternehmer ? t === "kleinunternehmer" : t !== "kleinunternehmer" || taxTreatment === t))
                    .map((t) => (
                      <option key={t} value={t}>
                        {TAX_TREATMENTS[t].label}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            {!special && (
              <Field label="Preise">
                {(control) => (
                  <select {...control} value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)}>
                    <option value="netto">Netto, zuzüglich Umsatzsteuer</option>
                    <option value="brutto">Brutto, inklusive Umsatzsteuer (Endpreise)</option>
                  </select>
                )}
              </Field>
            )}
            {special && (
              <Field label={taxTreatment === "steuerfrei" ? "Befreiungsvorschrift" : "Hinweis zur Umsatzsteuer (optional)"}>
                {(control) => (
                  <input
                    {...control}
                    value={exemptionReason}
                    onChange={(e) => setExemptionReason(e.target.value)}
                    maxLength={300}
                    placeholder={TAX_TREATMENTS[taxTreatment].note ?? ""}
                  />
                )}
              </Field>
            )}
          </div>
        </div>
        <div className="form-section">
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
            {mode === "festschreiben" && (
              <label className="checkbox" style={{ marginLeft: 24 }}>
                <input type="checkbox" checked={sendByMail} onChange={(e) => setSendByMail(e.target.checked)} />
                Und per E-Mail an den Kunden schicken (Vorlage aus Einstellungen › E-Mail-Versand)
              </label>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Aktiv
            </label>
          </fieldset>
        </div>
      </section>

      <section className="card" aria-labelledby="recurring-lines">
        <h2 id="recurring-lines">Positionen</h2>
        <TextBlockField
          label="Einleitung über den Positionen (optional)"
          kind="kopf"
          value={intro}
          onChange={setIntro}
          blocks={textBlocks}
          contactId={contactId || null}
        />
        <div className="line-row head" aria-hidden="true">
          <div className="num">Menge</div>
          <div>Einheit</div>
          <div className="num">Einzelpreis</div>
          <div>USt</div>
          <div className="num">{amountLabel}</div>
          <div />
        </div>
        {lines.map((line, index) => {
          const p = parsed[index]!;
          return (
            <div className="line-row" key={line.key}>
              <div className="line-title">
                <input
                  className="line-item"
                  placeholder="Art.-Nr."
                  aria-label={`Artikelnummer Position ${index + 1} (optional)`}
                  value={line.itemNumber}
                  maxLength={ITEM_NUMBER_MAX}
                  autoComplete="off"
                  onChange={(e) => updateLine(line.key, { itemNumber: e.target.value })}
                />
                <input
                  className="line-desc"
                  placeholder={`Beschreibung Position ${index + 1}, z. B. Wartung {monat} {jahr}`}
                  aria-label={`Beschreibung Position ${index + 1}`}
                  value={line.description}
                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  aria-invalid={line.description.trim() === ""}
                />
              </div>
              <FormattedTextarea
                className="line-detail"
                rows={line.detail ? Math.min(6, line.detail.split("\n").length) : 1}
                placeholder="Text zur Position (optional, mehrzeilig)"
                aria-label={`Text zu Position ${index + 1} (optional)`}
                value={line.detail}
                maxLength={LINE_DETAIL_MAX}
                onChange={(e) => updateLine(line.key, { detail: e.target.value })}
              />
              <LineCell label="Menge">
                <input
                  className="num"
                  inputMode="decimal"
                  aria-label={`Menge Position ${index + 1}`}
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  aria-invalid={parseQuantity(line.quantity) === null}
                />
              </LineCell>
              <LineCell label="Einheit">
                <select
                  aria-label={`Einheit Position ${index + 1}`}
                  value={line.unit}
                  onChange={(e) => updateLine(line.key, { unit: e.target.value as UnitLabel })}
                >
                  {Object.keys(UNITS).map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </LineCell>
              <LineCell label="Einzelpreis">
                <input
                  className="num"
                  inputMode="decimal"
                  aria-label={`Einzelpreis Position ${index + 1} in Euro`}
                  value={line.unitPrice}
                  placeholder="0,00"
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  aria-invalid={parseEuro(line.unitPrice) === null}
                />
              </LineCell>
              <LineCell label="USt">
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
              </LineCell>
              <LineAmount label={amountLabel}>{p.valid ? formatEuro(lineAmount(p.quantity, p.unitPrice)) : "–"}</LineAmount>
              <div className="line-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Position ${index + 1} entfernen`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
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
                {
                  key: nextKey++,
                  description: "",
                  detail: "",
                  itemNumber: "",
                  quantity: "1",
                  unit: prev.at(-1)?.unit ?? "Psch.",
                  unitPrice: "",
                  taxRate: prev.at(-1)?.taxRate ?? 1900,
                },
              ])
            }
          >
            <Icon name="plus" size={16} /> Position hinzufügen
          </button>
        </div>
        <TextBlockField
          label="Hinweis auf der Rechnung (optional)"
          kind="fuss"
          value={note}
          onChange={setNote}
          blocks={textBlocks}
          contactId={contactId || null}
        />
        <p className="small muted" style={{ margin: 0 }}>
          Platzhalter in Einleitung, Beschreibung, Text zur Position und Hinweis:{" "}
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
            {period ? `, Leistungszeitraum ${formatDate(period.from)} – ${formatDate(period.to)}` : ""}, {amountLabel.toLowerCase()} {formatEuro(sum)}
          </p>
          <ul className="small" style={{ margin: 0 }}>
            {parsed
              .filter((l) => l.description)
              .map((l, i) => (
                <li key={i}>
                  {fillPlaceholders(l.description, reference)}
                  {l.detail && (
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      <FormattedText text={fillPlaceholders(l.detail, reference)} />
                    </div>
                  )}
                </li>
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
