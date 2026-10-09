import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { saveDatevNumbersFn, type getDatevNumbers } from "../server/functions/datev-export.ts";

/** DATEV-Buchungsstapel für die Steuerberatung (Einstellungen); Jahre und Nummern kommen aus dem Loader */
export function DatevCard({ years, numbers }: { years: number[]; numbers: Awaited<ReturnType<typeof getDatevNumbers>> }) {
  const save = useServerFn(saveDatevNumbersFn);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [beraterNr, setBeraterNr] = useState(numbers.beraterNr);
  const [mandantNr, setMandantNr] = useState(numbers.mandantNr);
  const [saved, setSaved] = useState(Boolean(numbers.beraterNr && numbers.mandantNr));
  const { busy, notice, run } = useAction();
  const kontenrahmen = numbers.kontenrahmen;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await save({ data: { beraterNr, mandantNr } });
      setSaved(true);
    }, "Nummern gespeichert.");
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="datev-heading">
      <h2 id="datev-heading">DATEV-Export</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Alle Buchungen eines Jahres als DATEV-Buchungsstapel ({kontenrahmen || "SKR03/SKR04"}) für die Steuerberatung. Die Kontensalden
        stimmen mit der Saldenliste in Haben überein; die Umsatzsteuer steht wie im Journal auf eigenen Steuerkonten.
      </p>
      <div className="form-grid">
        <label className="field">
          Beraternummer
          <input value={beraterNr} onChange={(e) => (setBeraterNr(e.target.value.replace(/\D/g, "")), setSaved(false))} inputMode="numeric" maxLength={7} required />
        </label>
        <label className="field">
          Mandantennummer
          <input value={mandantNr} onChange={(e) => (setMandantNr(e.target.value.replace(/\D/g, "")), setSaved(false))} inputMode="numeric" maxLength={5} required />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Beide Nummern bekommst du von deiner Steuerberatung.</p>
      <div className="actions" style={{ flexWrap: "wrap", alignItems: "end" }}>
        <button type="submit" className="btn" disabled={busy || saved}>
          Nummern speichern
        </button>
        <label className="field" style={{ minWidth: 120 }}>
          Jahr
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {saved ? (
          <a className="btn btn-primary" href={`/api/datev/${year}`} download>
            Buchungsstapel herunterladen
          </a>
        ) : (
          <span className="small muted">Zum Herunterladen erst die Nummern speichern.</span>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
