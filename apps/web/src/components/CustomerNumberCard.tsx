import { DEFAULT_CUSTOMER_NUMBER_FORMAT, formatDocumentNumber, MAX_NUMBER_FORMAT_LENGTH, numberFormatError } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveCustomerNumberingSettings } from "../server/functions/company.ts";

/** Kundennummern automatisch beim Anlegen eines Kontakts, etwa K-0001; leeres Format = von Hand */
export function CustomerNumberCard({ format, next, year }: { format: string; next: number; year: number }) {
  const router = useRouter();
  const save = useServerFn(saveCustomerNumberingSettings);
  const { busy, notice, run } = useAction();
  const [value, setValue] = useState(format);
  const [nextValue, setNextValue] = useState(String(next));
  const trimmed = value.trim();
  const problem = trimmed ? numberFormatError(trimmed, { requireYear: false }) : null;
  const counter = Number(nextValue);
  const counterValid = Number.isInteger(counter) && counter >= 1;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(
      async () => {
        await save({ data: { format: trimmed, next: counter } });
        await router.invalidate();
      },
      trimmed ? "Kundennummern werden ab jetzt automatisch vergeben." : "Kundennummern trägst du wieder von Hand ein.",
    );
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="customer-number-heading">
      <h2 id="customer-number-heading">Kundennummern</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Mit einem Format vergibt Haben beim Anlegen eines Kontakts ohne eigene Nummer die nächste, z. B. <span className="mono">K-{"{NNNN}"}</span> →{" "}
        <span className="mono">K-0001</span>. Platzhalter wie beim Nummernformat; das Jahr ist hier nicht nötig. Nummern, die ein Kontakt schon hat, werden
        übersprungen. Leer lassen, um Nummern von Hand einzutragen.
      </p>
      <div className="form-grid">
        <label className="field">
          Format
          <input
            name="customer-number-format"
            className="mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={MAX_NUMBER_FORMAT_LENGTH}
            placeholder={DEFAULT_CUSTOMER_NUMBER_FORMAT}
            aria-invalid={problem ? true : undefined}
            aria-describedby="customer-number-hint"
          />
          <span id="customer-number-hint" className={problem ? "field-error" : "small muted"}>
            {problem ??
              (trimmed && counterValid ? (
                <>
                  Nächste: <span className="mono">{formatDocumentNumber(trimmed, year, counter)}</span>
                </>
              ) : (
                "Aus: Nummern von Hand"
              ))}
          </span>
        </label>
        <label className="field">
          Nächste laufende Nummer
          <input name="customer-number-next" type="number" min={1} value={nextValue} onChange={(e) => setNextValue(e.target.value)} required />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy || Boolean(problem) || !counterValid}>
          Kundennummern speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
