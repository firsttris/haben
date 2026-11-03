import { DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, formatDocumentNumber, MAX_NUMBER_FORMAT_LENGTH, numberFormatError } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveNumberFormatSettings } from "../server/functions/company.ts";

/** Eingabe eines Formats mit Beispiel oder Fehler darunter */
function FormatField({ label, name, value, onChange, year }: { label: string; name: string; value: string; onChange: (value: string) => void; year: number }) {
  const problem = numberFormatError(value.trim());
  const hintId = `${name}-hint`;
  return (
    <label className="field">
      {label}
      <input
        name={name}
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_NUMBER_FORMAT_LENGTH}
        required
        aria-invalid={problem ? true : undefined}
        aria-describedby={hintId}
      />
      <span id={hintId} className={problem ? "field-error" : "small muted"}>
        {problem ?? (
          <>
            Beispiel: <span className="mono">{formatDocumentNumber(value.trim(), year, 1)}</span>,{" "}
            <span className="mono">{formatDocumentNumber(value.trim(), year, 2)}</span>
          </>
        )}
      </span>
    </label>
  );
}

/** Aufbau der Rechnungs- und Angebotsnummern, etwa mit eigenem Präfix */
export function NumberFormatCard({ invoice, quote, year }: { invoice: string; quote: string; year: number }) {
  const router = useRouter();
  const save = useServerFn(saveNumberFormatSettings);
  const { busy, notice, run } = useAction();
  const [invoiceFormat, setInvoiceFormat] = useState(invoice);
  const [quoteFormat, setQuoteFormat] = useState(quote);
  const valid = !numberFormatError(invoiceFormat.trim()) && !numberFormatError(quoteFormat.trim());
  const isDefault = invoice === DEFAULT_INVOICE_NUMBER_FORMAT && quote === DEFAULT_QUOTE_NUMBER_FORMAT;

  const store = (formats: { invoice: string; quote: string }) =>
    run(async () => {
      await save({ data: formats });
      setInvoiceFormat(formats.invoice.trim());
      setQuoteFormat(formats.quote.trim());
      await router.invalidate();
    }, "Nummernformat gespeichert. Es gilt für alles, was ab jetzt festgeschrieben wird.");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void store({ invoice: invoiceFormat, quote: quoteFormat });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="number-format-heading">
      <h2 id="number-format-heading">Nummernformat</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Platzhalter: <span className="mono">{"{JJJJ}"}</span> Jahr, <span className="mono">{"{JJ}"}</span> Jahr zweistellig,{" "}
        <span className="mono">{"{NNN}"}</span> laufende Nummer mit so vielen Stellen (ein bis sechs N). Das Jahr gehört dazu, weil die laufende Nummer jedes
        Jahr bei 1 beginnt. Außerdem Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt, z. B.{" "}
        <span className="mono">
          RE-{"{JJJJ}"}-{"{NNNN}"}
        </span>
        . Schon vergebene Nummern bleiben, wie sie sind.
      </p>
      <div className="form-grid">
        <FormatField label="Rechnungen" name="invoice-format" value={invoiceFormat} onChange={setInvoiceFormat} year={year} />
        <FormatField label="Angebote" name="quote-format" value={quoteFormat} onChange={setQuoteFormat} year={year} />
      </div>
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <button type="submit" className="btn" disabled={busy || !valid}>
          Format speichern
        </button>
        {!isDefault && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void store({ invoice: DEFAULT_INVOICE_NUMBER_FORMAT, quote: DEFAULT_QUOTE_NUMBER_FORMAT })}
          >
            Auf Standard zurücksetzen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
