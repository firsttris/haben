import { currentYear, personenkontenBetroffen } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type MouseEvent } from "react";
import { downloadFrom } from "../lib/download.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveDatevNumbersFn, type getDatevNumbers } from "../server/functions/datev-export.ts";
import { Field } from "./Field.tsx";

/** DATEV-Buchungsstapel für die Steuerberatung (Einstellungen); Jahre und Nummern kommen aus dem Loader */
export function DatevCard({ years, numbers }: { years: number[]; numbers: Awaited<ReturnType<typeof getDatevNumbers>> }) {
  const save = useServerFn(saveDatevNumbersFn);
  const [year, setYear] = useState(() => currentYear());
  const [beraterNr, setBeraterNr] = useState(numbers.beraterNr);
  const [mandantNr, setMandantNr] = useState(numbers.mandantNr);
  const [ab, setAb] = useState<number | null>(numbers.personenkontenAb);
  const [savedAb, setSavedAb] = useState<number | null>(numbers.personenkontenAb);
  const [bestaetigt, setBestaetigt] = useState(false);
  const [saved, setSaved] = useState(Boolean(numbers.beraterNr && numbers.mandantNr));
  const { busy, notice, setNotice, run } = useAction();
  const kontenrahmen = numbers.kontenrahmen;
  const thisYear = currentYear();
  // Ab-Jahre: vom ersten gebuchten Jahr bis zum nächsten; ein gespeichertes älteres bleibt wählbar
  const firstYear = Math.min(numbers.gebuchteJahre[0] ?? thisYear, savedAb ?? thisYear, thisYear);
  const abYears = Array.from({ length: thisYear + 2 - firstYear }, (_, i) => firstYear + i);
  const betroffen = personenkontenBetroffen(savedAb, ab, numbers.gebuchteJahre, thisYear);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await save({ data: { beraterNr, mandantNr, personenkontenAb: ab, bestaetigt } });
      setSaved(true);
      setSavedAb(ab);
      setBestaetigt(false);
    }, "Gespeichert.");
  }

  /** Herunterladen über fetch, damit eine Ablehnung (etwa fehlende Personenkonten) und Nummern, die im Belegfeld 1 zusammenfallen, hier lesbar erscheinen */
  function onDownload(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const href = event.currentTarget.href;
    void run(async () => {
      const hinweis = await downloadFrom(href, `EXTF_Buchungsstapel_${year}.csv`);
      if (hinweis) setNotice({ tone: "info", text: hinweis });
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="datev-heading">
      <h2 id="datev-heading">DATEV-Export</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Alle Buchungen eines Jahres als DATEV-Buchungsstapel ({kontenrahmen || "SKR03/SKR04"}) für die Steuerberatung. Die Kontensalden stimmen mit der
        Saldenliste in Haben überein; die Umsatzsteuer steht wie im Journal auf eigenen Steuerkonten.
      </p>
      <div className="form-grid">
        <Field label="Beraternummer">
          {(control) => (
            <input
              {...control}
              value={beraterNr}
              onChange={(e) => {
                setBeraterNr(e.target.value.replace(/\D/g, ""));
                setSaved(false);
              }}
              inputMode="numeric"
              maxLength={7}
              required
            />
          )}
        </Field>
        <Field label="Mandantennummer">
          {(control) => (
            <input
              {...control}
              value={mandantNr}
              onChange={(e) => {
                setMandantNr(e.target.value.replace(/\D/g, ""));
                setSaved(false);
              }}
              inputMode="numeric"
              maxLength={5}
              required
            />
          )}
        </Field>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Beide Nummern bekommst du von deiner Steuerberatung.
      </p>
      <div className="field-group">
        <Field label="DATEV-Personenkonten" describedBy="personenkonten-hint">
          {(control) => (
            <select
              {...control}
              value={ab ?? ""}
              onChange={(e) => {
                setAb(e.target.value ? Number(e.target.value) : null);
                setBestaetigt(false);
                setSaved(false);
              }}
            >
              <option value="">nicht verwenden (Sammelkonten)</option>
              {abYears.map((y) => (
                <option key={y} value={y}>
                  ab {y}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p id="personenkonten-hint" className="field-hint">
          Statt der Sammelkonten für Forderungen und Verbindlichkeiten steht im Stapel der Debitor des Kunden bzw. der Kreditor des Lieferanten, wie am Kontakt
          eingetragen. Gilt ab Jahresbeginn; ab dem ersten Export ist die Nummer am Kontakt fest.
        </p>
        {betroffen.length > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} required />
            Der Stapel für {betroffen.join(", ")} hat schon Buchungen und sieht danach anders aus. Einen schon abgegebenen stimme ich mit der Steuerberatung ab.
          </label>
        )}
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy || saved}>
          Speichern
        </button>
      </div>
      <div className="actions" style={{ alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
        <Field label="Jahr" style={{ minWidth: 120 }}>
          {(control) => (
            <select {...control} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
        {saved ? (
          <a className="btn btn-primary" href={`/api/datev/${year}`} download onClick={onDownload}>
            Buchungsstapel herunterladen
          </a>
        ) : (
          <span className="small muted" style={{ alignSelf: "center" }}>
            Zum Herunterladen erst speichern.
          </span>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
