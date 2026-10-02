import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getExportYears } from "../server/functions/export.ts";

/** Jahresarchiv als ZIP herunterladen (Einstellungen) */
export function ExportCard() {
  const current = new Date().getFullYear();
  const loadYears = useServerFn(getExportYears);
  const [years, setYears] = useState<number[]>([current, current - 1]);
  const [year, setYear] = useState(current);

  useEffect(() => {
    let active = true;
    loadYears().then(
      (list) => {
        if (active && list.length > 0) setYears(list);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [loadYears]);

  return (
    <section className="card" aria-labelledby="export-heading">
      <h2 id="export-heading">Jahresarchiv</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Alle Rechnungen, Belege, Buchungen, Bankumsätze und Voranmeldungen eines Jahres als ZIP, mit den unveränderten
        Originaldateien, CSV-Tabellen und Prüfsummen. Für die Aufbewahrung (10 Jahre) zusätzlich zum Backup ablegen.
      </p>
      <label className="field">
        Jahr
        <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <a className="btn" href={`/api/export/${year}`} download>
          ZIP herunterladen
        </a>
      </div>
    </section>
  );
}
