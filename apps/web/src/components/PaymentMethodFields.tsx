import type { InvoicePaymentMethod } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import type { MandateOption } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";

export function PaymentTermField({
  value,
  dueDate,
  valid,
  error,
  onChange,
}: {
  value: string;
  dueDate: string;
  valid: boolean;
  error: string | null | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Zahlungsziel in Tagen" hint={<>fällig {formatDate(dueDate)}</>} error={error}>
      {(control) => <input {...control} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!valid} />}
    </Field>
  );
}

/**
 * Zahlungsangaben einer Rechnung: Überweisung, Einzug per SEPA-Lastschrift oder bereits erfolgte Zahlung.
 */
export function PaymentMethodFields({
  id,
  method,
  mandateId,
  mandates,
  contactId,
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
  /** Gewählter Kunde, leer solange keiner gewählt ist */
  contactId: string;
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
          {contactId === "" ? (
            "Erst den Kunden wählen."
          ) : (
            <>
              {mandateId === "" &&
                "Das Mandat ist die Einzugsermächtigung deines Kunden: Er erlaubt dir damit, den Betrag per SEPA-Lastschrift von seinem Konto einzuziehen. "}
              {mandates.length === 0 ? (
                <>
                  Für diesen Kunden gibt es kein gültiges Mandat. Du legst es beim Kontakt unter{" "}
                  <Link to="/kontakte/$id" params={{ id: contactId }} hash="mandate-heading" target="_blank" rel="noopener">
                    SEPA-Lastschriftmandate
                    <span className="visually-hidden"> (öffnet in neuem Tab)</span>
                  </Link>{" "}
                  an.
                </>
              ) : (
                "Die Rechnung kündigt den Einzug am Fälligkeitstag an. Ohne andere Absprache muss sie 14 Kalendertage vorher beim Kunden sein (SEPA-Rulebook); Skonto entfällt."
              )}
            </>
          )}
        </p>
      )}
    </>
  );
}
