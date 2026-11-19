import { advanceUsesPayments, CURRENCY_CODE, formatEuro, parseExchangeRate, skontoFristen, type PriceMode } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import { FORMAT_LABEL, FORMATS } from "../lib/invoice.ts";
import type { DraftInput } from "../server/modules/rechnungen/index.ts";
import { ContactCombobox } from "./ContactCombobox.tsx";
import { ContactPersonField } from "./ContactPersonField.tsx";
import { Field } from "./Field.tsx";
import { OrderReferenceFields } from "./OrderReferenceFields.tsx";
import { OutgoingTaxFields } from "./OutgoingTaxFields.tsx";
import { PaymentMethodFields, PaymentTermField } from "./PaymentMethodFields.tsx";
import { SkontoFields } from "./SkontoFields.tsx";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

// Karte „Rechnungsdaten“ bzw. „Angebotsdaten“: Art, Kunde, Daten, Zahlung, Währung, Format und Steuer

export function InvoiceEditorDetails({ editor }: { editor: InvoiceEditorModel }) {
  const {
    advanceType,
    alreadyPaid,
    attempted,
    chooseContact,
    chooseQuote,
    chooseTreatment,
    contactChoices,
    contactId,
    contactPersonId,
    contactPersons,
    contacts,
    customerQuotes,
    dueDate,
    editable,
    error,
    exemptionReason,
    format,
    grossPrices,
    initial,
    issueDate,
    kind,
    kleinunternehmer,
    language,
    mandateId,
    mandates,
    paidOn,
    paidVia,
    paymentMethod,
    paymentTermDays,
    previewGross,
    priceMode,
    quote,
    quoteId,
    references,
    serviceFrom,
    serviceTo,
    setContactPersonId,
    setExemptionReason,
    setFormat,
    setIssueDate,
    setLanguage,
    setMandateId,
    setNewContactName,
    setPaidOn,
    setPaidVia,
    setPaymentMethod,
    setPaymentTermDays,
    setPriceMode,
    setReferences,
    setServiceFrom,
    setServiceTo,
    setSkontoRows,
    setTaxDetails,
    setValidUntil,
    skonto,
    skontoAllowed,
    skontoIssue,
    skontoRows,
    special,
    taxDetails,
    taxTreatment,
    termValid,
    touch,
    validUntil,
    validUntilOk,
    variant,
  } = editor;
  return (
    <section className="card" aria-label={quote ? "Angebotsdaten" : "Rechnungsdaten"}>
      <div className="form-grid">
        <InvoiceVariantFields editor={editor} />
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
        <Field label="Leistung von" error={error("serviceFrom")}>
          {(control) => (
            <input
              {...control}
              type="date"
              value={serviceFrom}
              onChange={(e) => touch(setServiceFrom)(e.target.value)}
              required={variant === "abschlag" && advanceType === "teilleistung"}
            />
          )}
        </Field>
        <Field label="Leistung bis">
          {(control) => <input {...control} type="date" value={serviceTo} onChange={(e) => touch(setServiceTo)(e.target.value)} />}
        </Field>
        <OrderReferenceFields value={references} onChange={touch(setReferences)} disabled={!editable} />
        <Field label="Sprache" hint="Texte im PDF und in der E-Mail; die E-Rechnung selbst bleibt maschinenlesbar wie gehabt." style={{ gridColumn: "1 / -1" }}>
          {(control) => (
            <select {...control} value={language} onChange={(e) => touch(setLanguage)(e.target.value as "de" | "en")} disabled={!editable}>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          )}
        </Field>
        {kind === "rechnung" && <InvoiceCurrencyFields editor={editor} />}
        {!quote && (
          <Field label="E-Rechnungsformat" style={{ gridColumn: "1 / -1" }}>
            {(control) => (
              <select {...control} value={format} onChange={(e) => touch(setFormat)(e.target.value as DraftInput["format"])}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
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
      </div>
      {!contacts.length && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine Kontakte. <Link to="/kontakte/neu">Kunden anlegen</Link>
        </p>
      )}
    </section>
  );
}

export function InvoiceVariantFields({ editor }: { editor: InvoiceEditorModel }) {
  const { advanceType, chooseVariant, editable, kind, setAdvanceType, taxTreatment, touch, variant } = editor;
  return (
    <>
      {kind === "rechnung" && (
        <Field
          label="Rechnungsart"
          hint={
            variant &&
            (variant === "abschlag"
              ? "Anzahlung vor Leistung oder Rechnung über eine bereits erbrachte Teilleistung."
              : "Über die gesamte Leistung; die gewählten Abschlagsrechnungen werden mit Netto und Umsatzsteuer abgezogen.")
          }
          style={{ gridColumn: "1 / -1" }}
        >
          {(control) => (
            <select {...control} value={variant ?? ""} onChange={(e) => chooseVariant((e.target.value || null) as "abschlag" | "schluss" | null)}>
              <option value="">Rechnung</option>
              <option value="abschlag">Abschlagsrechnung</option>
              <option value="schluss">Schlussrechnung</option>
            </select>
          )}
        </Field>
      )}
      {kind === "rechnung" && variant === "abschlag" && (
        <div className="checkbox-hinted" style={{ gridColumn: "1 / -1" }}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={advanceType === "teilleistung"}
              disabled={!editable}
              aria-describedby="invoice-advance-hint"
              onChange={(e) => touch(setAdvanceType)(e.target.checked ? "teilleistung" : "anzahlung")}
            />
            Teilleistung bereits erbracht
          </label>
          <span id="invoice-advance-hint" className="field-hint">
            {advanceType === "teilleistung"
              ? taxTreatment === "regulaer"
                ? "Bei Soll-Versteuerung entsteht die Umsatzsteuer mit der Teilleistung."
                : "Tatsächliches Leistungsdatum der Teilleistung angeben. Der Meldezeitpunkt richtet sich nach der gewählten Steuerbehandlung."
              : taxTreatment === "regulaer"
                ? "Umsatzsteuer entsteht bei Zahlungseingang; bei Soll-Versteuerung spätestens mit der Schlussleistung."
                : taxTreatment === "kleinunternehmer"
                  ? "Als Kleinunternehmer weist du auf der Anzahlung keine Umsatzsteuer aus."
                  : advanceUsesPayments(taxTreatment)
                    ? "Steuerfreie Anzahlung ohne Umsatzsteuerausweis. Der Meldezeitpunkt richtet sich nach Zahlung und Schlussleistung."
                    : "Für diese Steuerbehandlung gelten die bisherigen Meldezeitpunkte; die Zahlungsregel für inländische Anzahlungen gilt hier nicht."}
          </span>
        </div>
      )}
    </>
  );
}

export function InvoiceCurrencyFields({ editor }: { editor: InvoiceEditorModel }) {
  const { currency, currencyCode, exchangeRate, exchangeRateDate, foreign, rateInfo, setCurrency, setExchangeRate, setExchangeRateDate, tageskurs, touch } =
    editor;
  return (
    <>
      <Field label="Währung" describedBy={foreign ? "invoice-currency-hint" : undefined}>
        {(control) => (
          <>
            <input
              {...control}
              value={currency}
              onChange={(e) => touch(setCurrency)(e.target.value.toUpperCase().slice(0, 3))}
              list="invoice-currency-codes"
              maxLength={3}
              className="mono"
              aria-invalid={!CURRENCY_CODE.test(currencyCode)}
            />
            <datalist id="invoice-currency-codes">
              {["EUR", "USD", "GBP", "CHF", "PLN", "SEK", "DKK", "JPY"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {foreign && (
        <Field label={<>Kurs: 1 EUR = … {CURRENCY_CODE.test(currencyCode) ? currencyCode : ""}</>} describedBy="invoice-currency-hint">
          {(control) => (
            <input
              {...control}
              className="mono"
              inputMode="decimal"
              value={exchangeRate}
              placeholder="leer = USt-Umrechnungskurs"
              onChange={(e) => touch(setExchangeRate)(e.target.value)}
              aria-invalid={exchangeRate.trim() !== "" && parseExchangeRate(exchangeRate) === null}
            />
          )}
        </Field>
      )}
      {foreign && tageskurs && (
        <Field label="Kursdatum">
          {(control) => <input {...control} type="date" value={exchangeRateDate} onChange={(e) => touch(setExchangeRateDate)(e.target.value)} />}
        </Field>
      )}
      {foreign && (
        <span id="invoice-currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
          {rateInfo && <strong>{rateInfo}. </strong>}
          Preise und Summen in {currencyCode || "der Fremdwährung"}; die Umsatzsteuer steht zusätzlich in Euro auf der Rechnung (§ 14 Abs. 4 Nr. 8 UStG).
          Gebucht wird in Euro. Ohne eigenen Kurs nimmt Haben den Umsatzsteuer-Umrechnungskurs des Leistungsmonats, sobald das BMF ihn veröffentlicht hat. Kein
          GiroCode, keine Abschlags- oder Schlussrechnung, keine Mahnung aus Haben.
        </span>
      )}
    </>
  );
}
