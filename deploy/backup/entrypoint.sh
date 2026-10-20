#!/bin/bash
# Einstiegspunkt des Backup-Images. Ohne Argument läuft backup.sh täglich um BACKUP_TIME (HH:MM, Zeitzone TZ),
# so betreibt Compose den Dienst backup. Mit Argument wird der Befehl ausgeführt, etwa backup.sh,
# restore.sh latest oder restic snapshots.
set -euo pipefail
if [ "${1:-zeitplan}" != zeitplan ]; then
  exec "$@"
fi
[[ "$BACKUP_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] \
  || { echo "BACKUP_TIME muss die Form HH:MM haben, ist aber: $BACKUP_TIME" >&2; exit 2; }
# Als PID 1 beendet nur ein eigener Handler den Container sofort; sleep läuft deshalb im Hintergrund
trap 'exit 0' TERM INT
echo "Backup täglich um $BACKUP_TIME ($TZ) nach $RESTIC_REPOSITORY"
while true; do
  now="$(date +%s)"
  next="$(date -d "today $BACKUP_TIME" +%s)"
  [ "$next" -gt "$now" ] || next="$(date -d "tomorrow $BACKUP_TIME" +%s)"
  echo "Nächstes Backup: $(date -d "@$next" '+%F %R')"
  sleep $((next - now)) &
  wait $!
  backup.sh || echo "Backup fehlgeschlagen, nächster Versuch zur gewohnten Zeit." >&2
done
