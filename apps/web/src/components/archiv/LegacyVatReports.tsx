import { formatEuro, periodKey, periodLabel } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDateTime } from "../../lib/format.ts";
import type { ArchiveSearch } from "../../routes/_app/archiv/index.tsx";
import type { getLegacyVatReports } from "../../server/functions/archive.ts";
import { ScrollBox } from "../ScrollTable.tsx";
import { YearSwitch } from "./YearSwitch.tsx";

type Row = Awaited<ReturnType<typeof getLegacyVatReports>>["rows"][number];

/** Übermittelte Voranmeldungen aus sevDesk: nur Nachweis, ohne Wirkung auf die Voranmeldungen in Haben (docs/sevdesk.md) */
export function LegacyVatReports({ rows, year, years, search }: { rows: Row[]; year: number; years: number[]; search: ArchiveSearch }) {
  return (
    <section className="card stack" aria-label="Voranmeldungen">
      <p className="muted">
        In sevDesk übermittelte Umsatzsteuer-Voranmeldungen mit Kennzahlen und Übermittlungsprotokoll, unverändert archiviert. Haben rechnet sie nicht neu und
        sendet sie nicht; deine Voranmeldungen in Haben bleiben davon unberührt.
      </p>
      <YearSwitch year={year} years={years} search={search} />
      {rows.length === 0 ? (
        <p className="muted">Keine Voranmeldungen für dieses Jahr.</p>
      ) : (
        <ScrollBox label="Archivierte Voranmeldungen">
          <table className="data-table">
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th>Übermittelt</th>
                <th>Versteuerung</th>
                <th className="num">Kz 83</th>
                <th>Kennzahlen</th>
                <th>Protokoll</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.month == null ? (
                      row.periodText
                    ) : (
                      <Link
                        to="/umsatzsteuer/$zeitraum"
                        params={{ zeitraum: periodKey({ year: row.year, month: row.month }) }}
                        title="Zeitraum in Haben öffnen"
                      >
                        {periodLabel({ year: row.year, month: row.month })}
                      </Link>
                    )}
                    {row.corrected && <span className="small muted"> · berichtigt</span>}
                  </td>
                  <td>{row.submittedAt ? formatDateTime(row.submittedAt) : "–"}</td>
                  <td>{row.actualTaxation == null ? "–" : row.actualTaxation ? "Ist" : "Soll"}</td>
                  <td className="num">{row.kz83 == null ? "–" : formatEuro(row.kz83)}</td>
                  <td>
                    {row.kennzahlen.length === 0 ? (
                      "–"
                    ) : (
                      <details>
                        <summary>{row.kennzahlen.length} Kennzahlen</summary>
                        <dl className="vat-report-values">
                          {row.kennzahlen.map((k) => (
                            <div key={k.kz}>
                              <dt>Kz {k.kz}</dt>
                              <dd className="num">{formatEuro(k.cents)}</dd>
                            </div>
                          ))}
                          {row.transferTicket && (
                            <div>
                              <dt>Transferticket</dt>
                              <dd className="mono">{row.transferTicket}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    )}
                  </td>
                  <td>
                    {row.files.length === 0
                      ? "Fehlt"
                      : row.files.map((f) => (
                          <a key={f.id} href={`/api/archiv/voranmeldungsdatei/${f.id}`} target="_blank" rel="noreferrer">
                            PDF
                          </a>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </section>
  );
}
