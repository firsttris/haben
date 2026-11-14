import { outgoingTaxIssues, section4Note, TAX_TREATMENTS, type OutgoingTaxDetails, type TaxTreatment } from "@haben/core";
import { Field } from "./Field.tsx";

const EMPTY_DETAILS: OutgoingTaxDetails = { exemption: null, ancillary: null, foreignPlace: null, assetDisposal: false };
const KU_TREATMENTS: TaxTreatment[] = ["kleinunternehmer", "steuerfrei", "reverse_charge", "drittland", "eu_sonstige"];

interface TaxFieldsProps {
  treatment: TaxTreatment;
  details: OutgoingTaxDetails | null;
  exemptionReason: string;
  kleinunternehmer: boolean;
  disabled?: boolean;
  onTreatmentChange: (value: TaxTreatment) => void;
  onDetailsChange: (value: OutgoingTaxDetails) => void;
  onReasonChange: (value: string) => void;
}

interface DetailsProps {
  values: OutgoingTaxDetails;
  disabled: boolean;
  update: (patch: Partial<OutgoingTaxDetails>) => void;
}

/** Dieselbe ausdrückliche Zuordnung für Rechnung, Angebot und Serienvorlage; kein Lesen der Vorschrift aus freiem Text. */
export function OutgoingTaxFields(props: TaxFieldsProps) {
  const { treatment, details, exemptionReason, kleinunternehmer, disabled = false, onTreatmentChange, onDetailsChange, onReasonChange } = props;
  const values = details ?? EMPTY_DETAILS;
  const canonicalNote = treatment === "steuerfrei" ? section4Note(values.exemption) : null;
  const foreign = treatment === "reverse_charge" || treatment === "drittland" || treatment === "eu_sonstige";
  const problems = disabled ? [] : outgoingTaxIssues(treatment, details, kleinunternehmer);
  const allowed = (value: TaxTreatment) => (kleinunternehmer ? KU_TREATMENTS.includes(value) : value !== "kleinunternehmer");
  const update = (patch: Partial<OutgoingTaxDetails>) => onDetailsChange({ ...values, ...patch });
  const detailsProps = { values, disabled, update };

  function chooseTreatment(value: TaxTreatment) {
    onTreatmentChange(value);
    onReasonChange("");
    // Eine neue Behandlung braucht eine eigene Zuordnung und bei Auslandsleistungen eine erneute Bestätigung.
    update({ exemption: null, ancillary: null, foreignPlace: null });
  }

  return (
    <div className="stack" style={{ gridColumn: "1 / -1" }}>
      <Field label="Umsatzsteuer" hint={treatmentHint(treatment, kleinunternehmer)}>
        {(control) => (
          <select {...control} value={treatment} disabled={disabled} onChange={(event) => chooseTreatment(event.target.value as TaxTreatment)}>
            {(Object.keys(TAX_TREATMENTS) as TaxTreatment[])
              .filter((value) => allowed(value) || value === treatment)
              .map((value) => (
                <option key={value} value={value} disabled={!allowed(value)}>
                  {TAX_TREATMENTS[value].label}
                </option>
              ))}
          </select>
        )}
      </Field>
      {treatment === "steuerfrei" && <ExemptionFields {...detailsProps} kleinunternehmer={kleinunternehmer} onReasonChange={onReasonChange} />}
      {foreign && <ForeignTaxFields {...detailsProps} treatment={treatment} kleinunternehmer={kleinunternehmer} />}
      {treatment !== "regulaer" && (
        <Field
          label={treatment === "steuerfrei" ? "Hinweis zur Steuerbefreiung" : "Hinweis zur Umsatzsteuer (optional)"}
          hint={canonicalNote ? "Aus der zugeordneten Vorschrift; steht auf dem Beleg." : undefined}
        >
          {(control) => (
            <input
              {...control}
              value={canonicalNote ?? exemptionReason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={300}
              placeholder={TAX_TREATMENTS[treatment].note ?? ""}
              readOnly={disabled || Boolean(canonicalNote)}
              required={treatment === "steuerfrei"}
            />
          )}
        </Field>
      )}
      <TurnoverFields {...detailsProps} treatment={treatment} />
      {problems.map((problem) => (
        <p key={problem} className="field-error" style={{ margin: 0 }}>
          {problem}
        </p>
      ))}
    </div>
  );
}

function ExemptionFields({
  values,
  disabled,
  update,
  kleinunternehmer,
  onReasonChange,
}: DetailsProps & Pick<TaxFieldsProps, "kleinunternehmer" | "onReasonChange">) {
  const provision = values.exemption;
  const provisionKey = provision ? `${provision.number}${provision.letter ?? ""}` : "";
  return (
    <>
      <Field
        label="Befreiungsvorschrift"
        hint="Wähle die für diese Leistung geprüfte Vorschrift. Die Auswahl gilt für den ganzen Beleg und setzt die gesetzlichen Voraussetzungen voraus."
      >
        {(control) => (
          <select
            {...control}
            value={provisionKey}
            disabled={disabled}
            required={kleinunternehmer}
            onChange={(event) => {
              const exemption = event.target.value === "14a" ? { number: "14", letter: "a" } : event.target.value === "21" ? { number: "21" } : null;
              update({ exemption });
              if (exemption) onReasonChange(section4Note(exemption)!);
            }}
          >
            <option value="">Nicht zugeordnet (ungeklärt)</option>
            <option value="14a">§ 4 Nr. 14 Buchst. a UStG – Heilbehandlung</option>
            <option value="21">§ 4 Nr. 21 UStG – Unterricht und Bildung</option>
            {provision && provisionKey !== "14a" && provisionKey !== "21" && (
              <option value={provisionKey} disabled>
                Bisherige Vorschrift: § 4 Nr. {provision.number}
                {provision.letter ? ` Buchst. ${provision.letter}` : ""} UStG
              </option>
            )}
          </select>
        )}
      </Field>
      {!provision && (
        <p className="field-hint" style={{ margin: 0 }}>
          Gesamtumsatz: Vorschrift ungeklärt. Ein bisheriger Befreiungstext wird nicht automatisch zugeordnet.
        </p>
      )}
    </>
  );
}

function ForeignTaxFields({ values, disabled, update, treatment, kleinunternehmer }: DetailsProps & Pick<TaxFieldsProps, "treatment" | "kleinunternehmer">) {
  const required = kleinunternehmer || treatment === "eu_sonstige";
  return (
    <>
      <Field
        label="Land des tatsächlichen Leistungsorts"
        hint="Ländercode, z. B. AT oder CH. Der Leistungsort folgt der Leistung; die Kundenanschrift allein genügt nicht (§ 3a UStG)."
      >
        {(control) => (
          <input
            {...control}
            value={values.foreignPlace?.country ?? ""}
            onChange={(event) => update({ foreignPlace: { country: event.target.value.toUpperCase(), noForeignVat: false } })}
            maxLength={2}
            pattern="[A-Z]{2}"
            placeholder={treatment === "drittland" ? "CH" : "AT"}
            disabled={disabled}
            required={required}
          />
        )}
      </Field>
      <Field
        label="Ausländische Umsatzsteuer"
        hint="Leistungsort und ausländische Behandlung sind geprüft. Ausländische Steuersätze, OSS und das besondere EU-Kleinunternehmerverfahren sind nicht enthalten."
      >
        {(control) => (
          <select
            {...control}
            value={values.foreignPlace?.noForeignVat ? "bestaetigt" : ""}
            disabled={disabled}
            required={required}
            onChange={(event) => update({ foreignPlace: { country: values.foreignPlace?.country ?? "", noForeignVat: event.target.value === "bestaetigt" } })}
          >
            <option value="">Behandlung noch nicht bestätigt</option>
            <option value="bestaetigt">Geprüft: keine ausländische Umsatzsteuer auszuweisen</option>
          </select>
        )}
      </Field>
      {!values.foreignPlace && (
        <p className="field-hint" style={{ margin: 0 }}>
          Gesamtumsatz: Leistungsort ungeklärt.
        </p>
      )}
    </>
  );
}

function TurnoverFields({ values, disabled, update, treatment }: DetailsProps & Pick<TaxFieldsProps, "treatment">) {
  return (
    <details>
      <summary className="small">Angaben zum Gesamtumsatz (§ 19 Abs. 2 UStG)</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <Field label="Verkauf aus dem Anlagevermögen" hint="Betrifft die Zählgrundlage des Gesamtumsatzes; etwa den Verkauf eines betrieblichen Geräts.">
          {(control) => (
            <select
              {...control}
              value={values.assetDisposal ? "ja" : "nein"}
              disabled={disabled}
              onChange={(event) => update({ assetDisposal: event.target.value === "ja" })}
            >
              <option value="nein">Nein</option>
              <option value="ja">Ja, Verkauf eines Wirtschaftsguts des Anlagevermögens</option>
            </select>
          )}
        </Field>
        {treatment === "steuerfrei" && (
          <Field
            label="Hilfsumsatz"
            hint="Für die Zählung bei § 4 Nr. 8 Buchst. a–h, Nr. 9 Buchst. a und Nr. 10 UStG; bei Heilbehandlung und Unterricht ohne Auswirkung."
          >
            {(control) => (
              <select
                {...control}
                value={values.ancillary === null ? "" : values.ancillary ? "ja" : "nein"}
                disabled={disabled}
                onChange={(event) => update({ ancillary: event.target.value === "" ? null : event.target.value === "ja" })}
              >
                <option value="">Nicht geklärt</option>
                <option value="nein">Nein</option>
                <option value="ja">Ja</option>
              </select>
            )}
          </Field>
        )}
      </div>
    </details>
  );
}

function treatmentHint(treatment: TaxTreatment, kleinunternehmer: boolean): string | undefined {
  switch (treatment) {
    case "kleinunternehmer":
      return "In den Einstellungen als Kleinunternehmer eingetragen. Eigene Befreiungen und geklärte Auslandsleistungen wählst du je Beleg.";
    case "reverse_charge":
      return "Nur für Leistungen an Unternehmen im EU-Ausland mit USt-IdNr.; zusätzlich in der Zusammenfassenden Meldung angeben. Nicht für Privatkunden.";
    case "eu_sonstige":
      return "Für geklärte sonstige Leistungen im EU-Ausland, auch an Privatkunden, ohne auszuweisende ausländische Umsatzsteuer. Kein B2B-Reverse-Charge.";
    case "ig_lieferung":
      return "Nur für Ware an ein Unternehmen in einem anderen EU-Land mit dessen USt-IdNr. Den Gelangensnachweis (§ 17a UStDV) zur Rechnung aufbewahren; Haben meldet Kz 41 und die Zusammenfassende Meldung.";
    case "ausfuhr":
      return "Nur für Ware, die ins Drittland gelangt, mit Ausfuhrnachweis (§§ 8–11 UStDV). Dienstleistungen ins Drittland sind „Leistung ins Nicht-EU-Ausland“.";
    default:
      return kleinunternehmer ? "Die Kleinunternehmerregelung lässt eine eigene Befreiung oder einen geklärten ausländischen Leistungsort zu." : undefined;
  }
}
