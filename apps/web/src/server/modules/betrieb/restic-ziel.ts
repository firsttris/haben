/**
 * Ziel des Backups, wie der Backup-Container es als RESTIC_REPOSITORY in backup_status einträgt. Formen nach der
 * restic-Doku (Abschnitt „Preparing a new repository“) und restic 0.19.1 (internal/backend/location/location.go).
 */

/**
 * Host einer Adresse mit optionalem Port, bis zu Pfad, Abfrage, Leerraum oder Anführungszeichen (auch JSON-escapt \").
 * Ein @ zählt nur als Ende der Zugangsdaten, wenn danach so ein Host folgt.
 */
const HOST = String.raw`(?:\[[0-9a-f:.]*\]|[^/?#\s"\\@:[\]]*)(?::\d*)?(?:[/?#\s"\\]|$)`;

/**
 * Nutzer und Passwort einer Adresse: wie bei Go url.Parse, das restic nutzt, bis zum letzten @ vor Pfad und Abfrage;
 * hat die Authority kein @, steht oft ein Passwort mit unkodiertem / davor (restic bricht ab und nennt die Adresse),
 * dann nach nutzer: bis zum ersten @, auf das ein Host folgt. Ohne nutzer: bleibt ein @ im Pfad stehen.
 */
const ADRESSE = new RegExp(String.raw`([a-z][a-z0-9+.-]*:\/\/)(?:[^/?#\s"]*@(?=${HOST})|[^/?#\s"[]*?:[^\s"]*?@(?=${HOST}))`, "gi");

/**
 * Zugangsdaten in einem Ziel von restic fallen weg, auch in Fehlermeldungen des Backups: Nutzer und Passwort einer
 * Adresse (ADRESSE), der Nutzer der Kurzform sftp:nutzer@host und die Parameter einer rclone-Verbindungszeichenkette
 * (rclone::sftp,pass=…:pfad). Nicht zu unterscheiden sind nutzer:12/ab@h und h:12/ab@h (Port, @ im Pfad); dann fällt
 * lieber das Ziel weg als das Passwort. Gleiche Regeln in deploy/backup/backup-status.sh.
 */
export const ohneZugangsdaten = (text: string) =>
  text
    .replace(ADRESSE, "$1")
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
