#!/bin/bash
# Backup: pg_dump über das Netz und die Belegdateien, verschlüsselt mit restic. Läuft im Image haben-backup.
# Erwartet die Verbindung zur Datenbank (PGHOST, PGUSER, PGDATABASE, PGPASSWORD), RESTIC_REPOSITORY,
# RESTIC_PASSWORD oder RESTIC_PASSWORD_FILE und die Belege lesend unter /belege.
# Zum Wiederherstellen braucht es außerdem denselben HABEN_ENCRYPTION_KEY (Zertifikat, Zugangsdaten im Dump).
set -euo pipefail
state=/var/lib/haben-backup
dump="$state/dump/haben.sql.gz"
mkdir -p "$state/dump"
# Ergebnis des Laufs für den Healthcheck des Compose-Dienstes: ok oder fehler, dazu der Zeitpunkt
finish() {
  local rc=$? result=ok
  [ "$rc" = 0 ] || result=fehler
  rm -f "$dump"
  echo "$result $(date -Iseconds)" > "$state/status"
}
trap finish EXIT

[ -d /belege ] || { echo "Die Belege sind nicht unter /belege eingehängt, Backup abgebrochen." >&2; exit 1; }

# Beim ersten Lauf das Repository anlegen; ein fehlendes meldet restic mit Exit-Code 10
rc=0
err="$(restic cat config 2>&1 > /dev/null)" || rc=$?
if [ "$rc" = 10 ]; then
  echo "Lege das restic-Repository $RESTIC_REPOSITORY an …"
  restic init
elif [ "$rc" != 0 ]; then
  echo "$err" >&2
  exit 1
fi

pg_dump --format=plain | gzip > "$dump"
# Ein abgebrochener Dump darf nicht als Backup durchgehen: gunzip prüft das Archiv (Prüfsumme), die
# Abschlusszeile von pg_dump zeigt, dass der Dump vollständig ist.
gunzip -c "$dump" | tail -n 20 | grep "PostgreSQL database dump complete" > /dev/null \
  || { echo "Dump unvollständig oder beschädigt, Backup abgebrochen." >&2; exit 1; }

# Fester Host und feste Pfade: Aufbewahrt wird je Host und Tag. Mehrere Instanzen in einem Repository
# brauchen deshalb je einen eigenen BACKUP_HOST. --retry-lock wartet, falls gerade ein anderer Lauf sichert.
# 11 Jahresstände decken die zehnjährige Aufbewahrung nach GoBD ab.
restic backup --retry-lock 10m --host "$BACKUP_HOST" --tag haben "$dump" /belege
restic forget --retry-lock 10m --tag haben --group-by host,tags \
  --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
