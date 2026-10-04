import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import { getExportYears } from "../server/functions/export.ts";
import { getDatevNumbers, saveDatevNumbersFn } from "../server/functions/datev-export.ts";

type Notice = { tone: "ok" | "danger"; text: string } | null;

/** DATEV-Buchungsstapel für die Steuerberatung (Einstellungen) */
export function DatevCard() {
  const current = new Date().getFullYear();
  const loadYears = useServerFn(getExportYears);
  const loadNumbers = useServerFn(getDatevNumbers);
  const save = useServerFn(saveDatevNumbersFn);
  const [years, setYears] = useState<number[]>([current, current - 1]);
  const [year, setYear] = useState(current);
  const [beraterNr, setBeraterNr] = useState("");
  const [mandantNr, setMandantNr] = useState("");
  const [saved, setSaved] = useState(false);
  const [kontenrahmen, setKontenrahmen] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadYears().then((list) => active && list.length > 0 && setYears(list), () => {});
    loadNumbers().then(
      (n) => {
        if (!active) return;
        setBeraterNr(n.beraterNr);
        setMandantNr(n.mandantNr);
        setKontenrahmen(n.kontenrahmen);
        setSaved(Boolean(n.beraterNr && n.mandantNr));
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [loadYears, loadNumbers]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await save({ data: { beraterNr, mandantNr } });
      setSaved(true);
      setNotice({ tone: "ok", text: "Nummern gespeichert." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
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
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}
    </form>
  );
}
