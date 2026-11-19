import {
  fillPlaceholders,
  formatEuro,
  type OutgoingTaxDetails,
  type PaymentMethod,
  type PriceMode,
  RECURRING_INTERVALS,
  type RecurringInterval,
  SERVICE_PERIOD_MODES,
  type ServicePeriodMode,
  type TaxTreatment,
  treatmentNote,
} from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { FORMAT_LABEL, FORMATS, type InvoiceFormat } from "../lib/invoice.ts";
import { ContactCombobox, type ContactChoice } from "./ContactCombobox.tsx";
import { Field } from "./Field.tsx";
import { OutgoingTaxFields } from "./OutgoingTaxFields.tsx";
import { FormattedText } from "./FormattedText.tsx";
import type { ParsedLine } from "./RecurringLines.tsx";

/* Abschnitte des Formulars für wiederkehrende Rechnungen (RecurringForm.tsx) */

type Fehler = (key: string) => string | undefined;

/** Bearbeitbarer Stand des Formulars; Zahlen und Datum ohne Wert als Text */
export type FormState = {
  name: string;
  active: boolean;
  contactId: string;
  format: InvoiceFormat;
  paymentTermDays: string;
  intro: string;
  note: string;
  propertyRetention: boolean;
  taxTreatment: TaxTreatment;
  exemptionReason: string;
  taxDetails: OutgoingTaxDetails | null;
  priceMode: PriceMode;
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string;
  servicePeriod: ServicePeriodMode;
  mode: "entwurf" | "festschreiben";
  sendByMail: boolean;
  paymentMethod: PaymentMethod;
};

type TeilProps = { v: FormState; set: (patch: Partial<FormState>) => void; error: Fehler };

export function RecurringSchedule({ v, set, error }: TeilProps) {
  return (
    <div className="form-section" role="group" aria-labelledby="recurring-dates">
      <h2 id="recurring-dates">Termine</h2>
      <div className="form-row cols-2">
        <Field label="Nächste Rechnung am" describedBy="next-hint" error={error("nextDate")}>
          {(control) => <input {...control} type="date" value={v.nextDate} onChange={(e) => set({ nextDate: e.target.value })} required />}
        </Field>
        <Field label="Intervall">
          {(control) => (
            <select {...control} value={v.intervalMonths} onChange={(e) => set({ intervalMonths: Number(e.target.value) as RecurringInterval })}>
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
        <Field label="Endet nach dem (optional)" error={error("endDate")}>
          {(control) => <input {...control} type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
        </Field>
        <Field label="Leistungszeitraum">
          {(control) => (
            <select {...control} value={v.servicePeriod} onChange={(e) => set({ servicePeriod: e.target.value as ServicePeriodMode })}>
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
  );
}

export function RecurringPayment({ v, set, error }: TeilProps) {
  return (
    <>
      <div className="form-row cols-2">
        <Field label="Zahlungsziel in Tagen" error={error("term")}>
          {(control) => <input {...control} inputMode="numeric" value={v.paymentTermDays} onChange={(e) => set({ paymentTermDays: e.target.value })} />}
        </Field>
        <Field label="E-Rechnungsformat">
          {(control) => (
            <select {...control} value={v.format} onChange={(e) => set({ format: e.target.value as InvoiceFormat })}>
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
          v.paymentMethod === "lastschrift" && (
            <>
              Jede Rechnung nimmt das jüngste Mandat des Kunden, das am Fälligkeitstag gilt, und kündigt den Einzug an diesem Tag an. Ohne gültiges Mandat
              entsteht keine Rechnung; der Hinweis steht dann an der Vorlage.
            </>
          )
        }
      >
        {(control) => (
          <select
            {...control}
            value={v.paymentMethod}
            onChange={(e) => set({ paymentMethod: e.target.value === "lastschrift" ? "lastschrift" : "ueberweisung" })}
          >
            <option value="ueberweisung">Überweisung</option>
            <option value="lastschrift">SEPA-Lastschrift</option>
          </select>
        )}
      </Field>
    </>
  );
}

export function RecurringRunMode({ v, set }: Omit<TeilProps, "error">) {
  return (
    <div className="form-section">
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend className="small muted" style={{ marginBottom: 4 }}>
          Was am Termin passiert
        </legend>
        <label className="checkbox">
          <input type="radio" name="mode" checked={v.mode === "entwurf"} onChange={() => set({ mode: "entwurf" })} />
          Entwurf anlegen; ich prüfe und schreibe selbst fest
        </label>
        <label className="checkbox">
          <input type="radio" name="mode" checked={v.mode === "festschreiben"} onChange={() => set({ mode: "festschreiben" })} />
          Direkt festschreiben (Nummer, PDF und XML, gebucht)
        </label>
        {v.mode === "festschreiben" && (
          <label className="checkbox" style={{ marginLeft: 24 }}>
            <input type="checkbox" checked={v.sendByMail} onChange={(e) => set({ sendByMail: e.target.checked })} />
            Und per E-Mail an den Kunden schicken (Vorlage aus Einstellungen › E-Mail-Versand)
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
          Aktiv
        </label>
      </fieldset>
    </div>
  );
}

export function RecurringPreview(props: {
  nextDate: string;
  period: { from: string; to: string } | null;
  reference: { from: string; to: string };
  amountLabel: string;
  sum: number;
  parsed: ParsedLine[];
  special: boolean;
  taxTreatment: TaxTreatment;
  taxNote: string;
}) {
  const { period, reference } = props;
  return (
    <section className="card stack" aria-label="Vorschau">
      <h2>Nächste Rechnung</h2>
      <p className="small" style={{ margin: 0 }}>
        Am {formatDate(props.nextDate)}
        {period ? `, Leistungszeitraum ${formatDate(period.from)} – ${formatDate(period.to)}` : ""}, {props.amountLabel.toLowerCase()} {formatEuro(props.sum)}
      </p>
      <ul className="small" style={{ margin: 0 }}>
        {props.parsed
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
      {props.special && (
        <p className="small" style={{ margin: 0 }}>
          {treatmentNote(props.taxTreatment, props.taxNote)}
        </p>
      )}
    </section>
  );
}

export function RecurringBasics({
  v,
  set,
  error,
  contacts,
  onCreateContact,
}: TeilProps & { contacts: ContactChoice[]; onCreateContact: (name: string) => void }) {
  return (
    <div className="form-section" role="group" aria-labelledby="recurring-basics">
      <h2 id="recurring-basics">Vorlage</h2>
      <div className="form-row cols-2">
        <Field label="Bezeichnung" error={error("name")}>
          {(control) => (
            <input
              {...control}
              value={v.name}
              onChange={(e) => set({ name: e.target.value })}
              maxLength={200}
              placeholder="z. B. Wartungsvertrag Nordwerk"
              required
            />
          )}
        </Field>
        <Field label="Kunde" error={error("contact")}>
          {(control) => (
            <ContactCombobox
              {...control}
              rolle="kunde"
              contacts={contacts}
              contactId={v.contactId}
              required
              onChoose={(contactId) => set({ contactId })}
              onCreate={onCreateContact}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

export function RecurringTax({ v, set, error, kleinunternehmer }: TeilProps & { kleinunternehmer: boolean }) {
  return (
    <div className="form-row cols-2">
      <OutgoingTaxFields
        treatment={v.taxTreatment}
        details={v.taxDetails}
        exemptionReason={v.exemptionReason}
        kleinunternehmer={kleinunternehmer}
        error={error("tax")}
        reasonError={error("exemption")}
        onTreatmentChange={(taxTreatment) => set({ taxTreatment })}
        onDetailsChange={(taxDetails) => set({ taxDetails })}
        onReasonChange={(exemptionReason) => set({ exemptionReason })}
      />
      {v.taxTreatment === "regulaer" && (
        <Field label="Preise">
          {(control) => (
            <select {...control} value={v.priceMode} onChange={(e) => set({ priceMode: e.target.value as PriceMode })}>
              <option value="netto">Netto, zuzüglich Umsatzsteuer</option>
              <option value="brutto">Brutto, inklusive Umsatzsteuer (Endpreise)</option>
            </select>
          )}
        </Field>
      )}
    </div>
  );
}
