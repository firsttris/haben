import { formatEuro, skontoFristen, type PriceMode } from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { ContactCombobox } from "./ContactCombobox.tsx";
import { ContactPersonField } from "./ContactPersonField.tsx";
import { Field } from "./Field.tsx";
import { OutgoingTaxFields } from "./OutgoingTaxFields.tsx";
import { PaymentMethodFields, PaymentTermField } from "./PaymentMethodFields.tsx";
import { SkontoFields } from "./SkontoFields.tsx";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

// Felder der Karte „Rechnungsdaten“ bzw. „Angebotsdaten“ (InvoiceEditorDetails): Kunde, Daten und Zahlung, Steuer und Preise

/** Kunde, Ansprechpartner und bei Abschlag oder Schlussrechnung das Angebot */
export function InvoiceCustomerFields({ editor }: { editor: InvoiceEditorModel }) {
  const {
    chooseContact,
    chooseQuote,
    contactChoices,
    contactId,
    contactPersonId,
    contactPersons,
    customerQuotes,
    editable,
    error,
    kind,
    quoteId,
    setContactPersonId,
    setNewContactName,
    touch,
    variant,
  } = editor;
  return (
    <>
      <Field label="Kunde" error={error("contact")} style={{ gridColumn: "1 / -1" }}>
        {(control) => (
          <ContactCombobox
            {...control}
            rolle="kunde"
            contacts={contactChoices}
            contactId={contactId}
            disabled={!editable}
            onChoose={chooseContact}
            onCreate={setNewContactName}
          />
        )}
      </Field>
      <ContactPersonField persons={contactPersons} contactId={contactId} value={contactPersonId} disabled={!editable} onChange={touch(setContactPersonId)} />
      {kind === "rechnung" && (variant || quoteId) && (
        <Field
          label="Angebot"
          hint={
            contactId
              ? "Die Schlussrechnung zu einem Angebot zieht nur dessen Abschläge ab; auf der Seite des Angebots stehen alle Rechnungen dazu."
              : "Zur Auswahl stehen die festgeschriebenen Angebote des gewählten Empfängers."
          }
          style={{ gridColumn: "1 / -1" }}
        >
          {(control) => (
            <select {...control} value={quoteId} onChange={(e) => chooseQuote(e.target.value)} disabled={!editable}>
              <option value="">Ohne Angebot</option>
              {customerQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  Angebot {q.number} vom {formatDate(q.issueDate)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}

/** Datum, Gültigkeit oder Zahlungsziel, Zahlungsweg und Skonto */
export function InvoiceDatePaymentFields({ editor }: { editor: InvoiceEditorModel }) {
  const {
    alreadyPaid,
    attempted,
    contactId,
    dueDate,
    error,
    initial,
    issueDate,
    kind,
    mandateId,
    mandates,
    paidOn,
    paidVia,
    paymentMethod,
    paymentTermDays,
    previewGross,
    quote,
    setIssueDate,
    setMandateId,
    setPaidOn,
    setPaidVia,
    setPaymentMethod,
    setPaymentTermDays,
    setSkontoRows,
    setValidUntil,
    skonto,
    skontoAllowed,
    skontoIssue,
    skontoRows,
    termValid,
    touch,
    validUntil,
    validUntilOk,
  } = editor;
  return (
    <>
      <Field label={quote ? "Angebotsdatum" : "Rechnungsdatum"} error={error("issueDate")}>
        {(control) => <input {...control} type="date" value={issueDate} onChange={(e) => touch(setIssueDate)(e.target.value)} required />}
      </Field>
      {quote ? (
        <Field label="Gültig bis" error={error("validUntil")}>
          {(control) => (
            <input
              {...control}
              type="date"
              value={validUntil}
              min={issueDate || undefined}
              onChange={(e) => touch(setValidUntil)(e.target.value)}
              aria-invalid={!validUntilOk}
              required
            />
          )}
        </Field>
      ) : alreadyPaid ? null : (
        <PaymentTermField value={paymentTermDays} dueDate={dueDate} valid={termValid} error={error("term")} onChange={touch(setPaymentTermDays)} />
      )}
      {kind === "rechnung" && (
        <PaymentMethodFields
          id="invoice-payment"
          method={paymentMethod}
          mandateId={mandateId}
          mandates={mandates.filter((m) => m.contactId === contactId || m.id === mandateId)}
          contactId={contactId}
          paidVia={paidVia}
          paidOn={paidOn}
          paidViaError={error("paidVia") ?? null}
          paidOnError={error("paidOn") ?? null}
          onPaidVia={touch(setPaidVia)}
          onPaidOn={touch(setPaidOn)}
          onChange={(method, mandate) => {
            touch(setPaymentMethod)(method);
            setMandateId(mandate);
          }}
        />
      )}
      {skontoAllowed && (
        <SkontoFields
          id="invoice-skonto"
          rows={skontoRows}
          onChange={touch(setSkontoRows)}
          problem={attempted || skonto.valid ? skontoIssue : null}
          describe={(stufe) => {
            const [frist] = skontoFristen([stufe], issueDate || initial.issueDate, previewGross);
            return frist ? `bis ${formatDate(frist.until)}: ${formatEuro(frist.amount)} Skonto, zu zahlen ${formatEuro(frist.payable)}` : null;
          }}
        />
      )}
    </>
  );
}

/** Umsatzsteuerliche Behandlung und Netto- oder Bruttopreise */
export function InvoiceTaxFields({ editor }: { editor: InvoiceEditorModel }) {
  const {
    chooseTreatment,
    editable,
    error,
    exemptionReason,
    grossPrices,
    kleinunternehmer,
    priceMode,
    setExemptionReason,
    setPriceMode,
    setTaxDetails,
    special,
    taxDetails,
    taxTreatment,
    touch,
  } = editor;
  return (
    <>
      <OutgoingTaxFields
        treatment={taxTreatment}
        details={taxDetails}
        exemptionReason={exemptionReason}
        kleinunternehmer={kleinunternehmer}
        disabled={!editable}
        error={error("tax")}
        reasonError={error("exemption")}
        onTreatmentChange={chooseTreatment}
        onDetailsChange={touch(setTaxDetails)}
        onReasonChange={touch(setExemptionReason)}
      />
      {!special && (
        <Field
          label="Preise"
          hint={
            <>
              {grossPrices
                ? "Endpreise für Verbraucher: Die Umsatzsteuer wird je Steuersatz aus der Summe herausgerechnet."
                : "Üblich zwischen Unternehmen: Die Umsatzsteuer kommt auf die Einzelpreise."}
              {!editable && " Wie in der ursprünglichen Rechnung."}
            </>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          {(control) => (
            <select {...control} value={priceMode} onChange={(e) => touch(setPriceMode)(e.target.value as PriceMode)} disabled={!editable}>
              <option value="netto">Netto, zuzüglich Umsatzsteuer</option>
              <option value="brutto">Brutto, inklusive Umsatzsteuer (Endpreise)</option>
            </select>
          )}
        </Field>
      )}
    </>
  );
}
