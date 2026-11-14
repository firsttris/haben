import { formatDateTime } from "../lib/format.ts";
import { releaseNotesUrl } from "../lib/release-notes.ts";
import type { AppVersionEntry } from "../server/modules/betrieb/index.ts";

/**
 * Zeigt in Einstellungen › Export den protokollierten Verlauf der eingesetzten Haben- und PostgreSQL-Versionen
 * inklusive Startzeitpunkt und Link zu den Versionshinweisen.
 */
export function VersionsCard({ versions }: { versions: AppVersionEntry[] }) {
  return (
    <section className="card" aria-labelledby="versions-heading">
      <h2 id="versions-heading">Eingesetzte Versionen</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Protokolliert jeden Start einer neuen Haben-Version (auch beim Zurückrollen auf einen älteren Stand) mit Zeitpunkt und PostgreSQL-Version im
        Änderungsprotokoll.
      </p>
      {versions.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Noch kein Versionsstart eingetragen. Beim Start über das Migrationsskript wird die laufende Version automatisch erfasst.
        </p>
      ) : (
        <table className="report-table stack-table" aria-labelledby="versions-heading">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Seit</th>
              <th scope="col">PostgreSQL</th>
              <th scope="col">Versionshinweise</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((entry) => (
              <tr key={entry.id}>
                <th scope="row" data-label="Version" className="mono" style={{ fontWeight: 600 }}>
                  v{entry.version}
                </th>
                <td data-label="Seit" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <div>{formatDateTime(entry.startedAt)}</div>
                  {entry.note && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {entry.note}
                    </div>
                  )}
                </td>
                <td data-label="PostgreSQL" className="mono" style={{ overflowWrap: "anywhere" }}>
                  {entry.postgresVersion}
                </td>
                <td data-label="Versionshinweise">
                  <a href={releaseNotesUrl(entry.version)} target="_blank" rel="noreferrer">
                    Versionshinweise (v{entry.version})
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
