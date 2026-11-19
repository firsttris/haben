import { formatEuro, type Zeitraum } from "@haben/core";
import { Link } from "@tanstack/react-router";
import type { BwaForm01Konto } from "../server/modules/auswertungen/index.ts";
import { ScrollTable } from "./ScrollTable.tsx";

/*
 * Teile der BWA für GmbH und UG (#1380): Kurzfristige Erfolgsrechnung nach dem Aufbau der DATEV-Form 01, periodengerecht.
 * Eine Zeile öffnet ihre Konten, je Konto führt ein Link auf das Kontenblatt für genau den Zeitraum der BWA.
 */

export function Form01Hinweis() {
  return (
    <p className="small muted">
      Eigene Auswertung von Haben nach dem Aufbau der DATEV-Form 01, keine Auswertung von DATEV. Periodengerecht nach Buchungsdatum wie die GuV, aus den Salden
      der Konten; Abschlussbuchungen, die noch fehlen, fehlen auch hier. Eine Zeile öffnet ihre Konten.
    </p>
  );
}

/**
 * Das Kontenblatt zeigt einen Zeitraum innerhalb eines Jahres. Reicht die BWA über den Jahreswechsel, öffnet der Link das
 * Jahr, in dem der Zeitraum endet, ab dem 1. Januar.
 */
function kontenblattZeitraum({ von, bis }: Zeitraum): Zeitraum {
  return von.slice(0, 4) === bis.slice(0, 4) ? { von, bis } : { von: `${bis.slice(0, 4)}-01-01`, bis };
}

export function BwaKonten({ titel, zeitraum, konten }: { titel: string; zeitraum: Zeitraum; konten: BwaForm01Konto[] }) {
  const blatt = kontenblattZeitraum(zeitraum);
  const linkTitel = blatt.von === zeitraum.von ? "Kontenblatt im Zeitraum" : `Kontenblatt ab 1. Januar ${blatt.von.slice(0, 4)}`;
  return (
    <section className="card bwa-details" id="details" aria-labelledby="details-titel">
      <h2 id="details-titel">{titel}</h2>
      {konten.length === 0 ? (
        <p className="muted">Keine Beträge im Zeitraum.</p>
      ) : (
        <ScrollTable className="report-table">
          <caption className="visually-hidden">Konten</caption>
          <thead>
            <tr>
              <th scope="col">Konto</th>
              <th scope="col">Bezeichnung</th>
              <th scope="col" className="num">
                Betrag
              </th>
            </tr>
          </thead>
          <tbody>
            {konten.map((k) => (
              <tr key={k.konto}>
                <td className="mono">
                  <Link
                    to="/konten/$konto"
                    params={{ konto: k.konto }}
                    search={{ jahr: Number(blatt.von.slice(0, 4)), von: blatt.von, bis: blatt.bis }}
                    title={linkTitel}
                  >
                    {k.konto}
                  </Link>
                </td>
                <td>{k.name}</td>
                <td className="num">{formatEuro(k.betrag)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Summe
              </th>
              <td className="num">{formatEuro(konten.reduce((s, k) => s + k.betrag, 0))}</td>
            </tr>
          </tfoot>
        </ScrollTable>
      )}
    </section>
  );
}
