import { CURRENCY_CODE, describeExchangeRate, parseExchangeRate } from "@haben/core";
import { Field } from "../../../components/Field.tsx";
import { WeitereAngaben, weitereAngabenKurz } from "../../../components/WeitereAngaben.tsx";
import type { DocumentFormState } from "./-beleg-zustand.ts";
import type { Detail } from "./-beleg-vorschau.tsx";

/** „Weitere Angaben“ am Beleg: USt-IdNr., Fälligkeit, Leistungszeitraum, Währung und Kurs, Notiz */
export function BelegWeitereAngaben({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { document: doc } = data;
  const {
    supplierUstId,
    setSupplierUstId,
    dueDate,
    setDueDate,
    serviceFrom,
    setServiceFrom,
    serviceTo,
    setServiceTo,
    note,
    setNote,
    currency,
    setCurrency,
    exchangeRate,
    setExchangeRate,
    exchangeRateDate,
    setExchangeRateDate,
    weitereOffen,
    setWeitereOffen,
    currencyCode,
    foreign,
    rate,
    error,
    touch,
  } = f;
  return (
    <WeitereAngaben
      kurz={weitereAngabenKurz({ currency, ustId: supplierUstId, dueDate, serviceFrom, serviceTo, note })}
      offen={weitereOffen}
      onOffen={setWeitereOffen}
    >
      <Field label="USt-IdNr. des Lieferanten">
        {(control) => <input {...control} value={supplierUstId} onChange={(e) => touch(setSupplierUstId)(e.target.value)} />}
      </Field>
      <Field label="Fällig am">{(control) => <input {...control} type="date" value={dueDate} onChange={(e) => touch(setDueDate)(e.target.value)} />}</Field>
      <Field label="Leistung von" describedBy="leistung-hint">
        {(control) => <input {...control} type="date" value={serviceFrom} onChange={(e) => touch(setServiceFrom)(e.target.value)} />}
      </Field>
      <Field label="Leistung bis" describedBy="leistung-hint" error={error("serviceTo")}>
        {(control) => <input {...control} type="date" value={serviceTo} onChange={(e) => touch(setServiceTo)(e.target.value)} />}
      </Field>
      <p className="small" id="leistung-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
        Zeitraum, auf den sich die Leistung bezieht, wenn er vom Belegdatum abweicht. Bleibt er leer, gilt das Belegdatum.
      </p>
      <Field label="Währung" describedBy={foreign ? "currency-hint" : undefined} error={error("currency")}>
        {(control) => (
          <>
            <input
              {...control}
              value={currency}
              onChange={(e) => touch(setCurrency)(e.target.value.toUpperCase().slice(0, 3))}
              list="currency-codes"
              maxLength={3}
            />
            <datalist id="currency-codes">
              {["EUR", "USD", "GBP", "CHF", "PLN", "SEK", "DKK", "JPY"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {foreign && (
        <Field label={<>Kurs: 1 EUR = … {CURRENCY_CODE.test(currencyCode) ? currencyCode : ""}</>} describedBy="currency-hint" error={error("exchangeRate")}>
          {(control) => (
            <input
              {...control}
              className="mono"
              inputMode="decimal"
              value={exchangeRate}
              placeholder="z. B. 1,0812"
              onChange={(e) => touch(setExchangeRate)(e.target.value)}
            />
          )}
        </Field>
      )}
      {foreign && data.tageskurs && (
        <Field label="Kursdatum">
          {(control) => <input {...control} type="date" value={exchangeRateDate} onChange={(e) => touch(setExchangeRateDate)(e.target.value)} />}
        </Field>
      )}
      {foreign && (
        <span id="currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
          {doc.exchangeRate && doc.currency === currencyCode && rate === parseExchangeRate(doc.exchangeRate) && (
            <>
              <strong>{describeExchangeRate(doc.currency, doc.exchangeRate, doc.exchangeRateSource, doc.exchangeRateDate)}</strong>.{" "}
            </>
          )}
          Beträge unten in {currencyCode || "der Fremdwährung"}, wie auf dem Beleg. Haben rechnet sie mit dem Kurs in Euro um und bucht nur Euro. Lässt du den
          Kurs leer, nimmt Haben den Umsatzsteuer-Umrechnungskurs des BMF für den Monat des Belegdatums (§ 16 Abs. 6 UStG), sobald er veröffentlicht ist
          {data.tageskurs ? "; mit gestattetem Tageskurs trägst du Kurs und Kursdatum ein" : ""}. Bei § 13b und beim innergemeinschaftlichen Erwerb wird die
          Steuer aus dem umgerechneten Netto berechnet.
        </span>
      )}
      <Field label="Notiz" style={{ gridColumn: "1 / -1" }}>
        {(control) => <textarea {...control} value={note} onChange={(e) => touch(setNote)(e.target.value)} maxLength={2000} />}
      </Field>
    </WeitereAngaben>
  );
}
