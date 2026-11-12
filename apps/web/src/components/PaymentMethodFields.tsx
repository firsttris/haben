import type { PaymentMethod } from "@haben/core";
import type { MandateOption } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";

/**
 * Zahlungsart einer Rechnung (#445): Überweisung oder Einzug per SEPA-Lastschrift mit einem Mandat des Kunden. Die
 * Rechnung kündigt den Einzug am Fälligkeitstag an (Vorabankündigung).
 */
export function PaymentMethodFields({
  id,
  method,
  mandateId,
  mandates,
  contactChosen,
  disabled = false,
  onChange,
}: {
  id: string;
  method: PaymentMethod;
  mandateId: string;
  /** Gültige Mandate des gewählten Kunden, das jüngste zuerst */
  mandates: MandateOption[];
  contactChosen: boolean;
  disabled?: boolean;
  onChange: (method: PaymentMethod, mandateId: string) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <>
      <Field label="Zahlungsart" describedBy={method === "lastschrift" ? hintId : undefined}>
        {(control) => (
          <select
            {...control}
            value={method}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value === "lastschrift" ? "lastschrift" : "ueberweisung";
              onChange(next, next === "lastschrift" ? mandateId || mandates[0]?.id || "" : "");
            }}
          >
            <option value="ueberweisung">Überweisung</option>
            <option value="lastschrift">SEPA-Lastschrift</option>
          </select>
        )}
      </Field>
      {method === "lastschrift" && (
        <Field label="Mandat" describedBy={hintId}>
          {(control) => (
            <select {...control} value={mandateId} disabled={disabled} onChange={(e) => onChange(method, e.target.value)}>
              <option value="">{mandates.length === 0 ? "Kein gültiges Mandat" : "Bitte wählen"}</option>
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.reference} · {m.scheme}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {method === "lastschrift" && (
        <p id={hintId} className="field-hint" style={{ gridColumn: "1 / -1" }}>
          {!contactChosen
            ? "Erst den Kunden wählen."
            : mandates.length === 0
              ? "Für diesen Kunden gibt es kein gültiges Mandat; leg es auf der Seite des Kontakts an."
              : "Die Rechnung kündigt den Einzug am Fälligkeitstag an. Ohne andere Absprache muss sie 14 Kalendertage vorher beim Kunden sein (SEPA-Rulebook); Skonto entfällt."}
        </p>
      )}
    </>
  );
}
