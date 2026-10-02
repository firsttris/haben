#!/bin/sh
# Tägliches Backup: pg_dump aus dem Datenbank-Container und die Belegdateien, verschlüsselt mit restic.
# Erwartet RESTIC_REPOSITORY und RESTIC_PASSWORD_FILE in der Umgebung.
set -eu
dump="$(mktemp -d)/haben.sql.gz"
trap 'rm -rf "$(dirname "$dump")"' EXIT
podman exec haben-db pg_dump -U haben --format=plain haben | gzip > "$dump"
belege="$(podman volume inspect haben-belege --format '{{.Mountpoint}}')"
# Im rootless Podman gehören die Belegdateien einer Unter-UID des Containers. `podman unshare`
# führt restic im Benutzer-Namensraum aus, dort sind sie lesbar (und behalten ihre Besitzer).
podman unshare restic backup --tag haben "$dump" "$belege"
restic forget --tag haben --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
