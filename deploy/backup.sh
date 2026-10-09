#!/bin/bash
# Tägliches Backup: pg_dump aus dem Datenbank-Container und die Belegdateien, verschlüsselt mit restic.
# Erwartet RESTIC_REPOSITORY und RESTIC_PASSWORD_FILE in der Umgebung.
# Zum Wiederherstellen braucht es außerdem denselben HABEN_ENCRYPTION_KEY (Zertifikat, Zugangsdaten im Dump).
set -euo pipefail
dump="$(mktemp -d)/haben.sql.gz"
trap 'rm -rf "$(dirname "$dump")"' EXIT
podman exec haben-db pg_dump -U haben --format=plain haben | gzip > "$dump"
# Ein abgebrochener Dump darf nicht als Backup durchgehen: gunzip prüft das Archiv (Prüfsumme), die
# Abschlusszeile von pg_dump zeigt, dass der Dump vollständig ist.
gunzip -c "$dump" | tail -n 20 | grep "PostgreSQL database dump complete" > /dev/null \
  || { echo "Dump unvollständig oder beschädigt, Backup abgebrochen." >&2; exit 1; }
belege="$(podman volume inspect haben-belege --format '{{.Mountpoint}}')"
# Im rootless Podman gehören die Belegdateien einer Unter-UID des Containers. `podman unshare`
# führt restic im Benutzer-Namensraum aus, dort sind sie lesbar (und behalten ihre Besitzer).
podman unshare restic backup --tag haben "$dump" "$belege"
restic forget --tag haben --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
