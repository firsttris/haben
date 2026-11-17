/**
 * Ziel des Backups, wie der Backup-Container es als RESTIC_REPOSITORY in backup_status einträgt. Formen nach der
 * restic-Doku (Abschnitt „Preparing a new repository“) und restic 0.19.1 (internal/backend/location/location.go).
 */

/**
 * Zugangsdaten in einem Ziel von restic fallen weg, auch in Fehlermeldungen des Backups: Nutzer und Passwort einer
 * Adresse (scheme://nutzer:passwort@host, bis zum letzten @ vor dem Pfad wie bei Go url.Parse, das restic nutzt), der
 * Nutzer der Kurzform sftp:nutzer@host und die Parameter einer rclone-Verbindungszeichenkette (rclone::sftp,pass=…:pfad).
 * Gleiche Regeln in deploy/backup/backup-status.sh.
 */
export const ohneZugangsdaten = (text: string) =>
  text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, "$1")
    .replace(/\b(sftp:)(?!\/\/)[^\s/@]+@/gi, "$1")
    .replace(/\b(rclone::?[\w.-]+),(?:"[^"]*"|'[^']*'|[^\s:"'])*/gi, "$1");

/**
 * Liegt das Repository in einem Verzeichnis des Backup-Containers? restic nimmt ein Backend nur mit seinem Namen vor
 * dem Doppelpunkt (sftp:, s3:, rest:, b2:, azure:, gs:, swift:, rclone:); ohne Namen oder mit local: ist es ein Pfad,
 * ein einzelner Buchstabe davor ein Laufwerk.
 */
export function isLocalRepository(repository: string): boolean {
  const scheme = /^([a-z][a-z0-9]+):/i.exec(repository)?.[1];
  return !scheme || scheme.toLowerCase() === "local";
}
