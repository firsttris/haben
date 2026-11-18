import { type OutgoingTaxDetails, TAX_TREATMENTS, type TaxTreatment } from "@haben/core";
import { Field } from "./Field.tsx";
import { EMPTY_DETAILS, ForeignTaxFields, treatmentHint } from "./OutgoingTaxFields.tsx";

/** Steuer der übernommenen Fremdrechnung (#660): Behandlung, Leistungsort im Ausland (#1392), Netto und Steuer je Satz */

export type TaxRow = { rate: string; net: string; tax: string };

const RATES = [
  { value: "1900", label: "19 %" },
  { value: "700", label: "7 %" },
  { value: "0", label: "0 %" },
];

/** Behandlungen mit tatsächlichem Leistungsort im Ausland (§ 3a UStG); nur für sie fragt das Formular ihn ab */
export const FOREIGN = new Set<TaxTreatment>(["reverse_charge", "drittland", "eu_sonstige"]);

/**
 * Behandlungen, die die Übernahme annimmt: Ein Kleinunternehmer übernimmt Rechnungen nach § 19 UStG und Auslandsleistungen mit
 * bestätigtem Leistungsort (wie im Editor), alle anderen nicht § 19. Die eigenen Befreiungen von Kleinunternehmern brauchen eine
 * strukturierte Vorschrift, die das Formular nicht abfragt; der Server lehnt sie ab, also werden sie nicht angeboten.
 */
function offeredTreatments(kleinunternehmer: boolean): TaxTreatment[] {
  const all = Object.keys(TAX_TREATMENTS) as TaxTreatment[];
  return kleinunternehmer ? all.filter((key) => key === "kleinunternehmer" || FOREIGN.has(key)) : all.filter((key) => key !== "kleinunternehmer");
}

export function TaxSection({
  treatment,
  onTreatment,
  kleinunternehmer,
  exemptionReason,
  onExemptionReason,
  foreignPlace,
  onForeignPlace,
  rows,
  onRows,
}: {
  treatment: TaxTreatment;
  kleinunternehmer: boolean;
  onTreatment: (treatment: TaxTreatment) => void;
  foreignPlace: OutgoingTaxDetails["foreignPlace"];
  onForeignPlace: (place: OutgoingTaxDetails["foreignPlace"]) => void;
  exemptionReason: string;
  onExemptionReason: (reason: string) => void;
  rows: TaxRow[];
  onRows: (rows: TaxRow[]) => void;
}) {
  return (
    <section className="form-section" aria-labelledby="fremdrechnung-steuer">
      <h2 id="fremdrechnung-steuer">Steuer</h2>
      <Field
        label="Steuerbehandlung"
        hint={
          kleinunternehmer && treatment === "kleinunternehmer"
            ? "Als Kleinunternehmer übernimmt Haben hier Rechnungen nach § 19 UStG und Auslandsleistungen mit geklärtem Leistungsort."
            : treatmentHint(treatment, false)
        }
      >
        {(control) => (
          <select {...control} value={treatment} onChange={(e) => onTreatment(e.target.value as TaxTreatment)}>
            {offeredTreatments(kleinunternehmer).map((key) => (
              <option key={key} value={key}>
                {TAX_TREATMENTS[key].label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {(treatment === "steuerfrei" || treatment === "kleinunternehmer") && (
        <Field label="Befreiungsvorschrift" hint="Wie auf der Rechnung, etwa „Steuerfrei nach § 4 Nr. 14 UStG“">
          {(control) => (
            <input {...control} value={exemptionReason} onChange={(e) => onExemptionReason(e.target.value)} required={treatment === "steuerfrei"} />
          )}
        </Field>
      )}
      {FOREIGN.has(treatment) && (
        <ForeignTaxFields
          values={{ ...EMPTY_DETAILS, foreignPlace }}
          disabled={false}
          update={(patch) => onForeignPlace(patch.foreignPlace ?? null)}
          treatment={treatment}
          kleinunternehmer={kleinunternehmer}
        />
      )}
      <TaxRowFields rows={rows} onChange={onRows} />
      <div className="actions">
        <button type="button" className="btn btn-sm" onClick={() => onRows([...rows, { rate: "0", net: "", tax: "0,00" }])}>
          Weiteren Steuersatz
        </button>
      </div>
    </section>
  );
}

function TaxRowFields({ rows, onChange }: { rows: TaxRow[]; onChange: (rows: TaxRow[]) => void }) {
  const set = (i: number, patch: Partial<TaxRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return rows.map((row, i) => (
    // Zeilen werden nur angehängt, nie umsortiert: der Index ist ein stabiler Schlüssel
    <div key={i} className="form-grid">
      <Field label={`Steuersatz ${i + 1}`}>
        {(control) => (
          <select {...control} value={row.rate} onChange={(e) => set(i, { rate: e.target.value })}>
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Netto ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.net} onChange={(e) => set(i, { net: e.target.value })} required />}
      </Field>
      <Field label={`Steuer ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.tax} onChange={(e) => set(i, { tax: e.target.value })} required />}
      </Field>
    </div>
  ));
}
