import { formatDateTime, formatSize } from "../lib/format.ts";
import type { getBackupStatus } from "../server/functions/backup.ts";

type Status = Awaited<ReturnType<typeof getBackupStatus>>;

export const BACKUP_DOCS = "https://firsttris.github.io/haben/installation.html#backup-und-wiederherstellen";

const ART = { backup: "Backup", restore_check: "Test-Restore" } as const;

/** Stand von Backup und wöchentlichem Test-Restore aus dem Backup-Container (Einstellungen → Export) */
export function BackupCard({ status }: { status: Status }) {
  const { state, overdue, lastBackup, lastCheck, failed } = status;
  return (
    <section className="card" aria-labelledby="backup-heading">
      <h2 id="backup-heading">Backup</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Der Backup-Container sichert Datenbank und Belege täglich mit restic und spielt einmal pro Woche das letzte Backup probeweise in eine
        Wegwerf-Datenbank ein: Hash-Kette und Siegel werden geprüft, einige Belege mit ihrer Prüfsumme verglichen. Hier steht das Ergebnis.
      </p>
      {state === "keins" && (
        <div className="banner banner-info">
          Noch kein Backup eingetragen. Ohne Backup-Container (oder mit einem anderen Backup) bleibt das so.{" "}
          <a href={BACKUP_DOCS} target="_blank" rel="noreferrer">
            Backup einrichten
          </a>
        </div>
      )}
      {overdue && (
        <div className="banner banner-danger" role="alert">
          {lastBackup
            ? `Das letzte erfolgreiche Backup ist vom ${formatDateTime(lastBackup.at)}, seitdem lief keins mehr durch. Läuft der Backup-Container?`
            : "Noch kein erfolgreiches Backup."}
        </div>
      )}
      {failed.map(({ kind, run }) => (
        <div key={kind} className="banner banner-danger" role="alert" style={{ overflowWrap: "anywhere" }}>
          {ART[kind]} am {formatDateTime(run.at)} fehlgeschlagen{run.message ? `: ${run.message}` : "."}
        </div>
      ))}
      {state !== "keins" && (
        <dl className="small" style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px" }}>
          <dt className="muted">Letztes Backup</dt>
          <dd style={{ margin: 0 }}>
            {lastBackup ? (
              <>
                {formatDateTime(lastBackup.at)}
                {lastBackup.bytes !== null && ` · ${formatSize(lastBackup.bytes)}`}
                {lastBackup.snapshot && <span className="mono muted"> · {lastBackup.snapshot}</span>}
              </>
            ) : (
              "–"
            )}
          </dd>
          <dt className="muted">Letzter Test-Restore</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
            {lastCheck ? `${formatDateTime(lastCheck.at)} · ${lastCheck.message}` : "Noch keiner, läuft einmal pro Woche nach dem Backup"}
          </dd>
        </dl>
      )}
    </section>
  );
}
