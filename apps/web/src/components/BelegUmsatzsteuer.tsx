import type { SelfAssessedTax } from "@haben/core";
import { Field } from "./Field.tsx";

/** Was die Wahl heißt, in Alltagssprache; Kennzahlen stehen eingeklappt darunter (Quelle: packages/core/src/posting.ts, REVERSE_CHARGE_IN und IG_ERWERB) */
const REVERSE_CHARGE_KURZ =
  "Die Rechnung weist keine deutsche Umsatzsteuer aus (Reverse Charge, § 13b UStG). Die Steuer schuldest du selbst; Haben rechnet sie aus dem Netto und zieht sie, soweit abziehbar, als Vorsteuer wieder ab. Bezahlt wird nur der Nettobetrag.";

const ERKLAERUNG: Record<SelfAssessedTax, { kurz: string; details: string }> = {
  eu: {
    kurz: REVERSE_CHARGE_KURZ,
    details: "Voranmeldung: Netto in Kz 46, Steuer in Kz 47, Vorsteuer in Kz 67. Nicht abziehbare Steuer wird Teil der Ausgabe.",
  },
  drittland: {
    kurz: REVERSE_CHARGE_KURZ,
    details: "Voranmeldung: Netto in Kz 84, Steuer in Kz 85, Vorsteuer in Kz 67. Nicht abziehbare Steuer wird Teil der Ausgabe.",
  },
  ig_erwerb: {
    kurz: "Ein Unternehmer aus einem anderen EU-Land liefert dir Ware ohne Umsatzsteuer, mit seiner und deiner USt-IdNr. auf der Rechnung. Die Erwerbsteuer schuldest du selbst; Haben rechnet sie aus dem Netto und zieht sie, soweit abziehbar, als Vorsteuer wieder ab. Bezahlt wird nur der Nettobetrag. Weist der Händler deutsche Umsatzsteuer aus, bleibt es ein gewöhnlicher Beleg.",
    details:
      "Voranmeldung: Netto in Kz 89 (19 %) bzw. Kz 93 (7 %), Vorsteuer in Kz 61, im Monat des Belegdatums, auch bei Ist-Versteuerung (§ 13 Abs. 1 Nr. 6 UStG). Nicht abziehbare Steuer wird Teil der Ausgabe.",
  },
};

/**
 * Die Frage am Beleg, ob deutsche Umsatzsteuer auf der Rechnung steht, mit der Antwort in Alltagssprache; Kennzahlen der
 * Voranmeldung stehen unter „Details“ (#1253). Gewählt wird derselbe Wert wie zuvor, nur die Beschriftung ist neu.
 */
export function BelegUmsatzsteuer({
  value,
  onChange,
  looksLikeReverseCharge,
}: {
  value: SelfAssessedTax | null;
  onChange: (value: SelfAssessedTax | null) => void;
  /** Lieferant mit USt-IdNr. aus einem anderen EU-Land und keine Steuer auf dem Beleg */
  looksLikeReverseCharge: boolean;
}) {
  return (
    <>
      <Field
        label="Steht deutsche Umsatzsteuer auf der Rechnung?"
        hint={
          value
            ? ERKLAERUNG[value].kurz
            : looksLikeReverseCharge && (
                <>
                  Lieferant aus dem EU-Ausland ohne Umsatzsteuer auf der Rechnung? Bei einer Dienstleistung, etwa von Google, Microsoft oder AWS, ist es meist
                  Reverse Charge (§ 13b), bei Ware ein innergemeinschaftlicher Erwerb (§ 1a).
                </>
              )
        }
      >
        {(control) => (
          <select {...control} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as SelfAssessedTax | null)}>
            <option value="">Ja (mit Vorsteuer, auch bei 0 %)</option>
            <option value="eu">Nein, EU-Leistung (§ 13b)</option>
            <option value="drittland">Nein, Drittland-Leistung (§ 13b)</option>
            <option value="ig_erwerb">Nein, Ware aus der EU (§ 1a)</option>
          </select>
        )}
      </Field>
      {value && (
        <details>
          <summary className="small">Details zur Voranmeldung</summary>
          <p className="small" style={{ margin: "8px 0 0" }}>
            {ERKLAERUNG[value].details}
          </p>
        </details>
      )}
    </>
  );
}
