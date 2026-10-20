# shellcheck shell=bash
# Von backup.sh und restore-check.sh eingebunden: trägt das Ergebnis eines Laufs in die Tabelle backup_status
# der App ein (Einstellungen → Export, Hinweis in der Übersicht). Fehlt die Tabelle (App älter als das Image)
# oder scheitert das Eintragen, bleibt es bei einer Meldung im Log; der Lauf selbst scheitert daran nicht.

# Gibt es die Tabelle backup_status?
status_table() {
  [ "$(psql -X -At -c "SELECT to_regclass('public.backup_status') IS NOT NULL" 2> /dev/null)" = t ]
}

# record_status <backup|restore_check> <true|false> <snapshot> <bytes> <meldung>
record_status() {
  if ! status_table; then
    echo "Tabelle backup_status fehlt (App älter als dieses Image); Ergebnis nicht in der App eingetragen." >&2
    return 0
  fi
  psql -X -q -v ON_ERROR_STOP=1 -v kind="$1" -v ok="$2" -v snapshot="$3" -v bytes="$4" -v message="$5" > /dev/null <<'SQL' \
    || echo "Ergebnis konnte nicht in backup_status eingetragen werden." >&2
INSERT INTO backup_status (kind, ok, snapshot, bytes, message)
VALUES (:'kind', :'ok'::boolean, nullif(:'snapshot', ''), nullif(:'bytes', '')::bigint, :'message');
SQL
}

# Die letzten Zeilen einer Fehlerausgabe als eine Meldung für die App. restic --json meldet Abbrüche als
# {"message_type":"exit_error",…,"message":"Fatal: …"}; davon zählt nur die Meldung.
last_error() {
  [ -s "$1" ] || { echo "Abgebrochen ohne Meldung"; return; }
  grep -v '^[[:space:]]*$' "$1" | tail -n 3 \
    | sed 's/^{"message_type":"exit_error".*"message":"\(.*\)"}$/\1/' \
    | tr '\n' ' ' | sed 's/ *$//' | cut -c1-500
}
