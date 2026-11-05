import type { Abschnitt } from "@haben/core";
import { useId } from "react";

/**
 * Ein Formular der Ausfüllliste, Abschnitt für Abschnitt in der Reihenfolge des SV-Meldeportals: links das Feld, in der
 * Mitte der Wert zum Abtippen, rechts der Hinweis. Fehlt eine Pflichtangabe, steht das am Feld.
 */
export function Formular({ abschnitte }: { abschnitte: Abschnitt[] }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {abschnitte.map((a) => (
        <AbschnittTabelle key={a.titel} abschnitt={a} />
      ))}
    </div>
  );
}

function AbschnittTabelle({ abschnitt }: { abschnitt: Abschnitt }) {
  const id = useId();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <h4 id={id} style={{ margin: 0 }}>
        {abschnitt.titel}
      </h4>
      <table className="report-table stack-table" aria-labelledby={id}>
        <thead>
          <tr>
            <th scope="col">Feld</th>
            <th scope="col">Eintragen</th>
            <th scope="col">Hinweis</th>
          </tr>
        </thead>
        <tbody>
          {abschnitt.felder.map((f) => (
            <tr key={f.name}>
              <th scope="row" data-label="Feld" style={{ fontWeight: 400 }}>
                {f.name}
                {f.schluessel && <span className="small muted"> ({f.schluessel})</span>}
              </th>
              <td data-label="Eintragen" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, overflowWrap: "anywhere" }}>
                {f.wert || (f.fehlt ? <span className="pill pill-danger">fehlt</span> : <span className="muted">–</span>)}
              </td>
              <td data-label="Hinweis" className="small muted">
                {f.hinweis ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
