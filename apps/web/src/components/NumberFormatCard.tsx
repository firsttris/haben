import { DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, formatDocumentNumber, MAX_NUMBER_FORMAT_LENGTH, numberFormatError } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveNumberFormatSettings } from "../server/functions/company.ts";

interface Circle {
  format: string;
  running: boolean;
}

/** Zwei Beispiele, beim durchlaufenden Zähler über den Jahreswechsel, sonst aus diesem Monat */
function examples(format: string, running: boolean, date: string): [string, string] {
  if (!running) return [formatDocumentNumber(format, date, 1), formatDocumentNumber(format, date, 2)];
  const year = Number(date.slice(0, 4));
  return [formatDocumentNumber(format, `${year}-12-31`, 412), formatDocumentNumber(format, `${year + 1}-01-02`, 413)];
}

/** Format und Zähler eines Nummernkreises, mit Beispiel oder Fehler darunter */
function CircleFields({ label, name, value, onChange, date }: { label: string; name: string; value: Circle; onChange: (value: Circle) => void; date: string }) {
  const format = value.format.trim();
  const problem = numberFormatError(format, { requireYear: !value.running });
  const hintId = `${name}-hint`;
  const [first, second] = problem ? ["", ""] : examples(format, value.running, date);
  return (
    <fieldset className="field-group" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small">{label}</legend>
      <label className="field">
        Format
        <input
          name={`${name}-format`}
          className="mono"
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value })}
          maxLength={MAX_NUMBER_FORMAT_LENGTH}
          required
          aria-invalid={problem ? true : undefined}
          aria-describedby={hintId}
        />
        <span id={hintId} className={problem ? "field-error" : "small muted"}>
          {problem ?? (
            <>
              Beispiel: <span className="mono">{first}</span>, <span className="mono">{second}</span>
            </>
          )}
        </span>
      </label>
      <label className="field">
        Zähler
        <select
          name={`${name}-running`}
          value={value.running ? "weiter" : "jaehrlich"}
          onChange={(e) => onChange({ ...value, running: e.target.value === "weiter" })}
        >
          <option value="jaehrlich">beginnt jedes Jahr neu</option>
          <option value="weiter">läuft weiter</option>
        </select>
      </label>
    </fieldset>
  );
}

/** Aufbau der Rechnungs- und Angebotsnummern, etwa mit eigenem Präfix, und ob der Zähler jährlich neu beginnt */
export function NumberFormatCard({
  invoice,
  quote,
  invoiceRunning,
  quoteRunning,
  date,
}: {
  invoice: string;
  quote: string;
  invoiceRunning: boolean;
  quoteRunning: boolean;
  date: string;
}) {
  const router = useRouter();
  const save = useServerFn(saveNumberFormatSettings);
  const { busy, notice, run } = useAction();
  const [invoiceCircle, setInvoiceCircle] = useState<Circle>({ format: invoice, running: invoiceRunning });
  const [quoteCircle, setQuoteCircle] = useState<Circle>({ format: quote, running: quoteRunning });
  const valid = [invoiceCircle, quoteCircle].every((c) => !numberFormatError(c.format.trim(), { requireYear: !c.running }));
  const isDefault = invoice === DEFAULT_INVOICE_NUMBER_FORMAT && quote === DEFAULT_QUOTE_NUMBER_FORMAT && !invoiceRunning && !quoteRunning;

  const store = (next: { invoice: Circle; quote: Circle }) =>
    run(async () => {
      await save({
        data: { invoice: next.invoice.format, quote: next.quote.format, invoiceRunning: next.invoice.running, quoteRunning: next.quote.running },
      });
      setInvoiceCircle({ ...next.invoice, format: next.invoice.format.trim() });
      setQuoteCircle({ ...next.quote, format: next.quote.format.trim() });
      await router.invalidate();
    }, "Nummernformat gespeichert. Es gilt für alles, was ab jetzt festgeschrieben wird.");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void store({ invoice: invoiceCircle, quote: quoteCircle });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="number-format-heading">
      <h2 id="number-format-heading">Nummernformat</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Platzhalter: <span className="mono">{"{JJJJ}"}</span> Jahr, <span className="mono">{"{JJ}"}</span> Jahr zweistellig,{" "}
        <span className="mono">{"{MM}"}</span> Monat, beides aus dem Rechnungs- bzw. Angebotsdatum, <span className="mono">{"{NNN}"}</span> laufende Nummer mit
        so vielen Stellen (ein bis sechs N). Beginnt der Zähler jedes Jahr neu, gehört das Jahr dazu; läuft er weiter, ist es frei. Außerdem Buchstaben,
        Ziffern, Bindestrich, Unterstrich und Punkt, z. B.{" "}
        <span className="mono">
          RE-{"{JJJJ}"}-{"{MM}"}-{"{NNNN}"}
        </span>
        . Schon vergebene Nummern bleiben, wie sie sind.
      </p>
      <div className="form-grid">
        <CircleFields label="Rechnungen" name="invoice" value={invoiceCircle} onChange={setInvoiceCircle} date={date} />
        <CircleFields label="Angebote" name="quote" value={quoteCircle} onChange={setQuoteCircle} date={date} />
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
            onClick={() =>
              void store({ invoice: { format: DEFAULT_INVOICE_NUMBER_FORMAT, running: false }, quote: { format: DEFAULT_QUOTE_NUMBER_FORMAT, running: false } })
            }
          >
            Auf Standard zurücksetzen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
