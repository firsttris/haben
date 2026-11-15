import type { InvoicePaymentMethod } from "@haben/core";
import type { MandateOption } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";

/**
 * Zahlungsangaben einer Rechnung: Überweisung, Einzug per SEPA-Lastschrift oder bereits erfolgte Zahlung.
 */
export function PaymentMethodFields({
  id,
  method,
  mandateId,
  mandates,
  contactChosen,
  disabled = false,
  paidVia,
  paidOn,
  paidViaError,
  paidOnError,
  onPaidVia,
  onPaidOn,
  onChange,
}: {
  id: string;
  method: InvoicePaymentMethod;
  mandateId: string;
  /** Gültige Mandate des gewählten Kunden, das jüngste zuerst */
  mandates: MandateOption[];
  contactChosen: boolean;
  disabled?: boolean;
  paidVia: string;
  paidOn: string;
  paidViaError: string | null;
  paidOnError: string | null;
  onPaidVia: (value: string) => void;
  onPaidOn: (value: string) => void;
  onChange: (method: InvoicePaymentMethod, mandateId: string) => void;
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
              const next = e.target.value as InvoicePaymentMethod;
              onChange(next, next === "lastschrift" ? mandateId || mandates[0]?.id || "" : "");
            }}
          >
            <option value="ueberweisung">Überweisung</option>
            <option value="lastschrift">SEPA-Lastschrift</option>
            <option value="bereits_bezahlt">Bereits bezahlt</option>
          </select>
        )}
      </Field>
      {method === "bereits_bezahlt" && (
        <>
          <Field label="Bezahlt über" hint="Zahlungsdienstleister oder „bar“" error={paidViaError}>
            {(control) => <input {...control} value={paidVia} maxLength={120} onChange={(e) => onPaidVia(e.target.value)} disabled={disabled} required />}
          </Field>
          <Field label="Bezahlt am" error={paidOnError}>
            {(control) => <input {...control} type="date" value={paidOn} onChange={(e) => onPaidOn(e.target.value)} disabled={disabled} required />}
          </Field>
        </>
      )}
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
