# shellcheck shell=bash
# Von backup.sh und restore-check.sh eingebunden: trägt das Ergebnis eines Laufs in die Tabelle backup_status
# der App ein (Einstellungen → Export, Hinweis in der Übersicht). Fehlt die Tabelle (App älter als das Image)
# oder scheitert das Eintragen, bleibt es bei einer Meldung im Log; der Lauf selbst scheitert daran nicht.

# Gibt es die Tabelle backup_status?
status_table() {
  [ "$(psql -X -At -c "SELECT to_regclass('public.backup_status') IS NOT NULL" 2> /dev/null)" = t ]
}

# Hat backup_status die Spalte target (App ab der Verfahrensdokumentation, #860)?
target_column() {
  [ "$(psql -X -At -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backup_status' AND column_name = 'target')" 2> /dev/null)" = t ]
}

# Ziel der Sicherung für die Verfahrensdokumentation, ohne Zugangsdaten: Nutzer und Passwort einer Adresse
# (rest:https://nutzer:passwort@…, bis zum letzten @ vor dem Pfad wie bei Go url.Parse in restic), den Nutzer von
# sftp:nutzer@host und die Parameter einer rclone-Verbindungszeichenkette (rclone::sftp,pass=…:pfad).
# Gleiche Regeln wie ohneZugangsdaten in apps/web/src/server/modules/verfahrensdoku/texte.ts.
target_without_credentials() {
  sed -E \
    -e 's#(://)[^/]*@#\1#' \
    -e 's#^sftp:([^/][^/@]*)@#sftp:#' \
    -e "s#^(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^:\"'])*#\\1#" \
    <<< "${RESTIC_REPOSITORY:-}"
}

# record_status <backup|restore_check> <true|false> <snapshot> <bytes> <meldung>
record_status() {
  if ! status_table; then
    echo "Tabelle backup_status fehlt (App älter als dieses Image); Ergebnis nicht in der App eingetragen." >&2
    return 0
  fi
  local columns="kind, ok, snapshot, bytes, message" values=":'kind', :'ok'::boolean, nullif(:'snapshot', ''), nullif(:'bytes', '')::bigint, :'message'"
  if target_column; then
    columns="$columns, target"
    values="$values, nullif(:'target', '')"
  fi
  psql -X -q -v ON_ERROR_STOP=1 -v kind="$1" -v ok="$2" -v snapshot="$3" -v bytes="$4" -v message="$5" \
    -v target="$(target_without_credentials)" > /dev/null <<SQL \
    || echo "Ergebnis konnte nicht in backup_status eingetragen werden." >&2
INSERT INTO backup_status ($columns) VALUES ($values);
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
