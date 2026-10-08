#!/bin/bash
# Stellt Datenbank und Belegdateien aus einem restic-Backup von backup.sh wieder her.
# Erwartet RESTIC_REPOSITORY und RESTIC_PASSWORD_FILE in der Umgebung (wie backup.sh).
#
#   restic snapshots --tag haben       # verfügbare Stände anzeigen
#   ./restore.sh latest                # oder ./restore.sh <snapshot-id>
#
# Achtung: ersetzt die aktuelle Datenbank und die Belegdateien vollständig.
# Die App muss mit demselben HABEN_ENCRYPTION_KEY laufen wie beim Backup, sonst lassen sich
# ELSTER-Zertifikat, Mail-, Bank- und Lexoffice-Zugänge aus dem Dump nicht mehr entschlüsseln.
set -euo pipefail
snapshot="${1:-}"
if [ -z "$snapshot" ]; then
  echo "Aufruf: $0 <snapshot-id|latest>" >&2
  exit 2
fi
printf 'Datenbank und Belege werden durch Snapshot %s ersetzt. Fortfahren? [ja/nein] ' "$snapshot"
read -r answer
[ "$answer" = "ja" ] || { echo "Abgebrochen."; exit 1; }

work="$(mktemp -d)"
trap 'podman unshare rm -rf "$work"' EXIT

echo "Hole Snapshot $snapshot …"
podman unshare restic restore "$snapshot" --tag haben --target "$work"
dump="$(podman unshare find "$work" -name haben.sql.gz | head -n 1)"
source="$(podman unshare find "$work" -type d -path '*/haben-belege/_data' | head -n 1)"
[ -n "$dump" ] || { echo "Im Snapshot fehlt haben.sql.gz." >&2; exit 1; }
[ -n "$source" ] || { echo "Im Snapshot fehlen die Belegdateien." >&2; exit 1; }
# Erst prüfen, dann ersetzen: Archiv lesbar und Dump vollständig
gunzip -c "$dump" | tail -n 20 | grep "PostgreSQL database dump complete" > /dev/null \
  || { echo "Der Dump im Snapshot ist unvollständig oder beschädigt; nichts geändert." >&2; exit 1; }

echo "Spiele die Datenbank in haben_restore ein …"
podman exec haben-db dropdb -U haben --if-exists haben_restore
podman exec haben-db createdb -U haben haben_restore
if ! gunzip -c "$dump" | podman exec -i haben-db psql -U haben -v ON_ERROR_STOP=1 --quiet haben_restore > /dev/null; then
  podman exec haben-db dropdb -U haben --if-exists haben_restore
  echo "Einspielen fehlgeschlagen; die bisherige Datenbank ist unverändert." >&2
  exit 1
fi

echo "Stoppe die App …"
systemctl --user stop haben-app.service

echo "Ersetze die Datenbank …"
podman exec haben-db dropdb -U haben --if-exists haben
podman exec haben-db psql -U haben -d postgres -v ON_ERROR_STOP=1 --quiet -c 'ALTER DATABASE haben_restore RENAME TO haben'

echo "Stelle die Belegdateien wieder her …"
belege="$(podman volume inspect haben-belege --format '{{.Mountpoint}}')"
podman unshare sh -c 'find "$1" -mindepth 1 -delete && cp -a "$2/." "$1/"' sh "$belege" "$source"

echo "Starte die App …"
systemctl --user start haben-app.service
echo "Fertig. Bitte anmelden und Stichproben prüfen (letzte Rechnung, letzter Beleg, Bankumsätze)."
echo "Lässt sich das ELSTER-Zertifikat nicht mehr öffnen, läuft die App mit einem anderen HABEN_ENCRYPTION_KEY als beim Backup."
