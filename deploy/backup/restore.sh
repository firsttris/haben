#!/bin/bash
# Stellt Datenbank und Belegdateien aus einem restic-Backup von backup.sh wieder her. Läuft im Image
# haben-backup mit schreibbar eingehängtem /belege; die App muss gestoppt sein.
#
#   docker compose stop app
#   docker compose run --rm restore              # verfügbare Stände anzeigen
#   docker compose run --rm restore latest       # oder eine Snapshot-ID
#   docker compose start app
#
# Mit den Quadlets steht der Aufruf in docs/installation.md (Backup und Wiederherstellen).
# Achtung: ersetzt die aktuelle Datenbank und die Belegdateien vollständig.
# Die App muss mit demselben HABEN_ENCRYPTION_KEY laufen wie beim Backup, sonst lassen sich
# ELSTER-Zertifikat, Mail-, Bank- und Lexoffice-Zugänge aus dem Dump nicht mehr entschlüsseln.
set -euo pipefail
snapshot="${1:-}"
if [ -z "$snapshot" ]; then
  restic snapshots --tag haben
  echo "Aufruf: restore.sh <snapshot-id|latest>; latest ist der neueste Stand von Host $BACKUP_HOST." >&2
  exit 2
fi
db="$PGDATABASE"
# Keine NOTICE-Zeilen von dropdb --if-exists
export PGOPTIONS="-c client_min_messages=warning"
admin() { psql -X -d postgres -v ON_ERROR_STOP=1 --quiet "$@"; }
app_running() {
  [ "$(admin -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$db'")" != 0 ]
}

[ -w /belege ] || { echo "/belege ist nicht schreibbar eingehängt; nichts geändert." >&2; exit 1; }
if app_running; then
  echo "Mit der Datenbank $db sind noch Verbindungen offen. Erst die App stoppen; nichts geändert." >&2
  exit 1
fi

printf 'Datenbank und Belege werden durch Snapshot %s ersetzt. Fortfahren? [ja/nein] ' "$snapshot"
read -r answer || true
[ "$answer" = "ja" ] || { echo "Abgebrochen."; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Hole Snapshot $snapshot …"
# Filter wirken nur auf latest; eine Snapshot-ID gilt unabhängig vom Host
restic restore "$snapshot" --host "$BACKUP_HOST" --tag haben --target "$work"
dump="$(find "$work" -type f -name haben.sql.gz | head -n 1)"
# Snapshots dieses Images enthalten /belege, ältere aus dem Host-Skript der Quadlets das Volume-Verzeichnis
if [ -d "$work/belege" ]; then
  source="$work/belege"
else
  source="$(find "$work" -type d -path '*/haben-belege/_data' | head -n 1)"
fi
[ -n "$dump" ] || { echo "Im Snapshot fehlt haben.sql.gz; nichts geändert." >&2; exit 1; }
[ -n "$source" ] || { echo "Im Snapshot fehlen die Belegdateien; nichts geändert." >&2; exit 1; }
# Erst prüfen, dann ersetzen: Archiv lesbar und Dump vollständig
gunzip -c "$dump" | tail -n 20 | grep "PostgreSQL database dump complete" > /dev/null \
  || { echo "Der Dump im Snapshot ist unvollständig oder beschädigt; nichts geändert." >&2; exit 1; }

echo "Spiele die Datenbank in ${db}_restore ein …"
dropdb --if-exists "${db}_restore"
createdb "${db}_restore"
if ! gunzip -c "$dump" | psql -X -d "${db}_restore" -v ON_ERROR_STOP=1 --quiet > /dev/null; then
  dropdb --if-exists "${db}_restore"
  echo "Einspielen fehlgeschlagen; die bisherige Datenbank ist unverändert." >&2
  exit 1
fi

# Die App könnte inzwischen gestartet worden sein
if app_running; then
  dropdb --if-exists "${db}_restore"
  echo "Die App hat sich inzwischen mit $db verbunden. Erst stoppen; nichts geändert." >&2
  exit 1
fi
echo "Ersetze die Datenbank …"
dropdb --if-exists "$db"
admin -c "ALTER DATABASE \"${db}_restore\" RENAME TO \"$db\""

echo "Stelle die Belegdateien wieder her …"
find /belege -mindepth 1 -delete
cp -a "$source/." /belege/
# Die App läuft als Nutzer node (UID 1000); auf einem frischen System legt erst dieser Aufruf das Volume an
chown -R 1000:1000 /belege

echo "Fertig. App starten, anmelden und Stichproben prüfen (letzte Rechnung, letzter Beleg, Bankumsätze)."
echo "Lässt sich das ELSTER-Zertifikat nicht mehr öffnen, läuft die App mit einem anderen HABEN_ENCRYPTION_KEY als beim Backup."
