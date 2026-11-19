import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { FORMAT_LABEL, FORMATS } from "../../lib/invoice.ts";
import { Field } from "../Field.tsx";
import { FormattedTextarea } from "../FormattedTextarea.tsx";
import { SkontoFields, type SkontoRow } from "../SkontoFields.tsx";

type Firma = Awaited<ReturnType<typeof loadCompany>>;

export function RechnungenAngebote({ company, skontoRows, onSkonto }: { company: Firma; skontoRows: SkontoRow[]; onSkonto: (rows: SkontoRow[]) => void }) {
  return (
    <section className="form-section" aria-labelledby="company-invoices">
      <h3 id="company-invoices">Rechnungen und Angebote</h3>
      <div className="form-row cols-2">
        <Field label="Standard-Zahlungsziel in Tagen">
          {(control) => <input {...control} name="paymentTermDays" inputMode="numeric" defaultValue={company.paymentTermDays} />}
        </Field>
        <Field label="Standardformat für Rechnungen">
          {(control) => (
            <select {...control} name="defaultFormat" defaultValue={company.defaultFormat}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <SkontoFields
        id="company-skonto"
        rows={skontoRows}
        onChange={onSkonto}
        hint="Vorgabe für neue Rechnungen, z. B. 2 % bei Zahlung innerhalb von 10 Tagen; am Kunden und in der Rechnung änderbar. Die Frist zählt ab dem Rechnungsdatum und endet spätestens mit dem Zahlungsziel."
      />
      <div className="form-row cols-2">
        <Field label="Standard-Einleitung für Rechnungen" describedBy="intro-hint">
          {(control) => <FormattedTextarea {...control} name="invoiceIntro" rows={3} maxLength={2000} defaultValue={company.invoiceIntro} />}
        </Field>
        <Field label="Standard-Einleitung für Angebote" describedBy="intro-hint">
          {(control) => <FormattedTextarea {...control} name="quoteIntro" rows={3} maxLength={2000} defaultValue={company.quoteIntro} />}
        </Field>
      </div>
      <p id="intro-hint" className="field-hint">
        Steht in neuen Rechnungen und Angeboten als Einleitung über den Positionen und lässt sich dort anpassen. Rechnungen und Angebote, die es schon gibt,
        ändern sich nicht. Leer = keine Einleitung.
      </p>
    </section>
  );
}
