#!/bin/bash
# Test-Restore: prüft, ob sich ein Backup von backup.sh wirklich einspielen lässt, ohne etwas zu ersetzen.
# backup.sh ruft ihn wöchentlich nach einem erfolgreichen Backup auf, von Hand: restore-check.sh [snapshot-id]
#
#  1. restic check liest einen Teil der Daten im Repository (RESTORE_CHECK_SUBSET, Standard 5%).
#  2. Der Dump aus dem Snapshot wird in eine Wegwerf-Datenbank <PGDATABASE>_restore_check_<Zeit>_<Zufall> eingespielt.
#  3. Darin: Hash-Kette und Siegel prüfen (haben_integrity_problems, dieselbe Prüfung wie in der App), der Kopf
#     der Kette muss als Eintrag in der laufenden Datenbank stehen, und RESTORE_CHECK_FILES (Standard 20)
#     zufällige Belege kommen aus dem Snapshot und müssen ihre Prüfsumme haben.
#  4. Die Wegwerf-Datenbank wird gelöscht, das Ergebnis steht in backup_status.
#
# Platzbedarf: kurzzeitig eine zweite Kopie der Datenbank auf dem Datenbankserver und der gepackte Dump hier.
set -euo pipefail
. "${BASH_SOURCE[0]%/*}/backup-status.sh"
snapshot="${1:-latest}"
subset="${RESTORE_CHECK_SUBSET:-5%}"
samples="${RESTORE_CHECK_FILES:-20}"
live="$PGDATABASE"
# Eigener Name je Lauf: Zwei Test-Restores (etwa der wöchentliche und einer von Hand, mit den Quadlets in
# getrennten Containern) dürfen sich die Wegwerf-Datenbank nicht gegenseitig löschen
check_db="${PGDATABASE}_restore_check_$(date +%Y%m%d%H%M%S)_$RANDOM"
export PGOPTIONS="-c client_min_messages=warning"
work="$(mktemp -d)"
errlog="$work/fehler.log"
exec 3>&2 2> >(tee -a "$errlog" >&3)
tee_pid=$!
ok=false
message=""
finish() {
  local rc=$?
  exec 2>&3
  wait "$tee_pid" 2> /dev/null || true
  dropdb --if-exists "$check_db" 2> /dev/null || echo "Wegwerf-Datenbank $check_db ließ sich nicht löschen." >&2
  if [ "$rc" = 0 ] && [ "$ok" = true ]; then
    record_status restore_check true "$snapshot" "" "$message"
    echo "Test-Restore bestanden: $message"
  else
    record_status restore_check false "$snapshot" "" "$(last_error "$errlog")"
  fi
  rm -rf "$work"
}
trap finish EXIT
fail() { echo "$*" >&2; exit 1; }
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
[[ "$samples" =~ ^[0-9]{1,4}$ ]] || fail "RESTORE_CHECK_FILES muss eine Zahl bis 9999 sein, ist aber: $samples"

echo "Prüfe das Repository (restic check, $subset der Daten) …"
restic check --retry-lock 10m --read-data-subset "$subset" > /dev/null

# latest heißt der neueste Stand dieses Hosts (Filter wirken nur darauf); danach gilt die kurze ID
filters=()
[ "$snapshot" != latest ] || filters=(--host "$BACKUP_HOST" --tag haben)
snapshot="$(restic snapshots --json "${filters[@]}" "$snapshot" | { grep -o '"short_id":"[0-9a-f]*"' || true; } | tail -n 1 | cut -d'"' -f4)"
[ -n "$snapshot" ] || fail "Kein Snapshot ${1:-latest} für Host $BACKUP_HOST gefunden."
echo "Spiele Snapshot $snapshot in $check_db ein …"
restic dump "$snapshot" /var/lib/haben-backup/dump/haben.sql.gz > "$work/haben.sql.gz" \
  || fail "Snapshot $snapshot enthält keinen Dump unter /var/lib/haben-backup/dump/haben.sql.gz."
gunzip -c "$work/haben.sql.gz" | tail -n 20 | grep "PostgreSQL database dump complete" > /dev/null \
  || fail "Der Dump in Snapshot $snapshot ist unvollständig oder beschädigt."
createdb "$check_db"
gunzip -c "$work/haben.sql.gz" | psql -X -d "$check_db" -v ON_ERROR_STOP=1 --quiet > /dev/null \
  || fail "Der Dump aus Snapshot $snapshot ließ sich nicht einspielen."
rm -f "$work/haben.sql.gz"

tables="$(q -d "$check_db" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$tables" -gt 0 ] || fail "Der Dump aus Snapshot $snapshot enthält keine Tabellen."
summary="$tables Tabellen"

# Hash-Kette und Siegel wie „Kette prüfen“ in der App; ältere Stände ohne Kette werden nur eingespielt
if [ "$(q -d "$check_db" -c "SELECT to_regprocedure('haben_integrity_problems(integer)') IS NOT NULL")" = t ]; then
  problems="$(q -d "$check_db" -F ': ' -c "SELECT tabelle, befund FROM haben_integrity_problems(5)")"
  [ -z "$problems" ] || fail "Hash-Kette oder Siegel im Backup beschädigt: $(head -n 3 <<< "$problems" | tr '\n' ' ')"
  read -r seq hash <<< "$(q -d "$check_db" -F ' ' -c "SELECT seq, encode(hash, 'hex') FROM audit_chain")"
  [ -n "${seq:-}" ] || fail "Im Backup fehlt der Kopf der Kette (audit_chain)."
  # Der Stand im Backup muss ein Anfang der laufenden Kette sein: derselbe Eintrag mit demselben Hash
  live_hash="$(q -d "$live" -v seq="$seq" <<< "SELECT encode(row_hash, 'hex') FROM audit_log WHERE seq = :'seq'")"
  [ -n "$live_hash" ] || fail "Eintrag Nr. $seq aus dem Backup fehlt in der laufenden Datenbank."
  [ "$live_hash" = "$hash" ] || fail "Eintrag Nr. $seq hat im Backup einen anderen Hash als in der laufenden Datenbank."
  summary="$summary, Kette bis Nr. $seq geprüft und gleich der laufenden Datenbank"
fi

# Stichprobe der Belege: liegen unter /belege/<ersten zwei Zeichen>/<SHA-256>
if [ "$samples" != 0 ] && [ "$(q -d "$check_db" -c "SELECT to_regclass('public.documents') IS NOT NULL")" = t ]; then
  checked=0
  while read -r sha; do
    [ -n "$sha" ] || continue
    actual="$(restic dump "$snapshot" "/belege/${sha:0:2}/$sha" | sha256sum | cut -d' ' -f1)" \
      || fail "Beleg $sha fehlt im Snapshot $snapshot."
    [ "$actual" = "$sha" ] || fail "Beleg $sha im Snapshot $snapshot hat eine andere Prüfsumme ($actual)."
    checked=$((checked + 1))
  done <<< "$(q -d "$check_db" -c "SELECT sha256 FROM (SELECT sha256 FROM documents UNION SELECT sha256 FROM archive_files) f
    ORDER BY random() LIMIT $samples")"
  [ "$checked" = 1 ] && word=Beleg || word=Belege
  summary="$summary, $checked $word"
fi

message="$summary, $subset der Daten gelesen"
ok=true
