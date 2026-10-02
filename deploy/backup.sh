#!/bin/sh
# Tägliches Backup: pg_dump aus dem Datenbank-Container, verschlüsselt mit restic.
# Erwartet RESTIC_REPOSITORY und RESTIC_PASSWORD_FILE in der Umgebung.
set -eu
dump="$(mktemp -d)/haben.sql.gz"
trap 'rm -rf "$(dirname "$dump")"' EXIT
podman exec haben-db pg_dump -U haben --format=plain haben | gzip > "$dump"
belege="$(podman volume inspect haben-belege --format '{{.Mountpoint}}')"
restic backup --tag haben "$dump" "$belege"
restic forget --tag haben --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
