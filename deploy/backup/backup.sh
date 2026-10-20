#!/bin/bash
# Backup: pg_dump über das Netz und die Belegdateien, verschlüsselt mit restic. Läuft im Image haben-backup.
# Erwartet die Verbindung zur Datenbank (PGHOST, PGUSER, PGDATABASE, PGPASSWORD), RESTIC_REPOSITORY,
# RESTIC_PASSWORD oder RESTIC_PASSWORD_FILE und die Belege lesend unter /belege.
# Zum Wiederherstellen braucht es außerdem denselben HABEN_ENCRYPTION_KEY (Zertifikat, Zugangsdaten im Dump).
# Das Ergebnis steht danach in der App (Tabelle backup_status); alle RESTORE_CHECK_DAYS Tage (Standard 7, 0 aus)
# folgt auf ein erfolgreiches Backup ein Test-Restore mit restore-check.sh.
set -euo pipefail
. "${BASH_SOURCE[0]%/*}/backup-status.sh"
state=/var/lib/haben-backup
dump="$state/dump/haben.sql.gz"
mkdir -p "$state/dump"
# Ein ungültiger Wert betrifft nur den Test-Restore, das Backup läuft trotzdem
days="${RESTORE_CHECK_DAYS:-7}"
if [[ "$days" =~ ^[0-9]{1,4}$ ]]; then
  days=$((10#$days))
else
  echo "RESTORE_CHECK_DAYS muss eine Zahl bis 9999 sein, ist aber: $days; der Test-Restore läuft alle 7 Tage." >&2
  days=7
fi
# Ein Lauf zur Zeit: Der Dump liegt immer unter demselben Pfad. Ein zweiter Lauf (etwa von Hand vor einem
# Update, während der Zeitplan sichert) wartet bis zu einer Stunde, statt den Dump des ersten zu überschreiben.
exec 9> "$state/lock"
flock -w 3600 9 || { echo "Ein anderes Backup läuft seit über einer Stunde, Backup abgebrochen." >&2; exit 1; }
# Fehlerausgabe zusätzlich in eine Datei, damit die Meldung bei einem Fehlschlag in der App steht
errlog="$state/backup.err"
: > "$errlog"
exec 3>&2 2> >(tee -a "$errlog" >&3)
tee_pid=$!
# Ergebnis des Laufs für den Healthcheck des Compose-Dienstes (ok oder fehler, dazu der Zeitpunkt) und,
# bei einem Fehlschlag, für die App; ein erfolgreicher Lauf trägt sich schon vor dem Test-Restore ein
finish() {
  local rc=$? result=ok
  exec 2>&3
  wait "$tee_pid" 2> /dev/null || true
  rm -f "$dump"
  if [ "$rc" != 0 ]; then
    result=fehler
    record_status backup false "" "" "$(last_error "$errlog")"
  fi
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
# brauchen deshalb je einen eigenen BACKUP_HOST. --retry-lock wartet auf restic-Sperren anderer Zugriffe
# auf dasselbe Repository (etwa restic snapshots oder eine zweite Instanz).
# 11 Jahresstände decken die zehnjährige Aufbewahrung nach GoBD ab.
summary="$(restic backup --json --retry-lock 10m --host "$BACKUP_HOST" --tag haben "$dump" /belege | grep '"message_type":"summary"')"
snapshot="$(sed -n 's/.*"snapshot_id":"\([0-9a-f]\{8\}\)[0-9a-f]*".*/\1/p' <<< "$summary")"
bytes="$(sed -n 's/.*"total_bytes_processed":\([0-9]*\).*/\1/p' <<< "$summary")"
[ -n "$snapshot" ] || { echo "restic hat keinen Snapshot gemeldet, Backup abgebrochen." >&2; exit 1; }
files="$(sed -n 's/.*"total_files_processed":\([0-9]*\).*/\1/p' <<< "$summary")"
echo "Snapshot $snapshot: ${files:-?} Dateien, ${bytes:-?} Byte"
restic forget --retry-lock 10m --tag haben --group-by host,tags \
  --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
record_status backup true "$snapshot" "$bytes" "${files:-?} Dateien"

# Wöchentlicher Test-Restore: fällig, wenn in den letzten RESTORE_CHECK_DAYS Tagen (12 Stunden Spielraum für
# die Uhrzeit) keiner lief; ohne Tabelle backup_status sonntags. Sein Ergebnis steht für sich in der App,
# das Backup bleibt erfolgreich.
due=false
if [ "$days" != 0 ]; then
  if status_table; then
    # Ein Fehler hier darf das schon eingetragene Backup nicht nachträglich scheitern lassen
    due="$(psql -X -At -c "SELECT NOT EXISTS (SELECT 1 FROM backup_status WHERE kind = 'restore_check'
      AND at > now() - interval '1 day' * $days + interval '12 hours')")" \
      || { echo "Ob ein Test-Restore fällig ist, ließ sich nicht abfragen; er entfällt diesmal." >&2; due=false; }
  elif [ "$(date +%u)" = 7 ]; then
    due=t
  fi
fi
if [ "$due" = t ]; then
  restore-check.sh "$snapshot" || echo "Test-Restore fehlgeschlagen; das Backup selbst ist erfolgreich." >&2
fi
