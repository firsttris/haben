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

# Ziel der Sicherung für Einstellungen → Export und die Verfahrensdokumentation, ohne Zugangsdaten: Nutzer und
# Passwort einer Adresse (credentials_from_address), den Nutzer von sftp:nutzer@host und die Parameter einer
# rclone-Verbindungszeichenkette (rclone::sftp,pass=…:pfad). Gleiche Regeln wie ohneZugangsdaten in
# apps/web/src/server/modules/betrieb/restic-ziel.ts, nur für ein Ziel statt einer Meldung: Leerraum und " beenden
# die Zugangsdaten hier nicht, sie gehören zum Passwort.
target_without_credentials() {
  printf '%s\n' "${RESTIC_REPOSITORY:-}" | credentials_from_address | sed -E \
    -e 's#^sftp:([^/][^/@]*)@#sftp:#' \
    -e "s#^(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^:\"'])*#\\1#"
}

# Nutzer und Passwort der Adresse nach dem ersten ://: wie bei Go url.Parse in restic bis zum letzten @ vor Pfad und
# Abfrage, wenn danach ein Host folgt. Hat dieser Teil kein @, steht oft ein Passwort mit unkodiertem / davor: dann
# nach nutzer: bis zum ersten @, auf das ein Host folgt. Folgt keinem @ ein Host, aber die Authority hat eins, fällt sie
# bis dorthin trotzdem weg: lieber ein falsches Ziel als ein Passwort. Ohne nutzer: und ohne @ in der Authority bleibt
# ein @ im Pfad stehen (rest:https://h/haben@2026). Nur POSIX-awk ohne Zeichenklassen, damit mawk, gawk und busybox gleich rechnen.
credentials_from_address() {
  awk '
    # Länge von s vor dem ersten Zeichen aus stop
    function upto(s, stop,   i) {
      for (i = 1; i <= length(s); i++) if (index(stop, substr(s, i, 1))) return i - 1
      return length(s)
    }
    # Beginnt s mit einem Host samt optionalem Port: [IPv6] oder ohne @ : [ ] Leerraum und "? Leerraum und " am Ende
    # gehören nicht zum Host (rest:https://u:p@host "…).
    function is_host(s,   h) {
      h = substr(s, 1, upto(s, "/?#\\"))
      sub(/[ \t"]+$/, "", h)
      sub(/:[0-9]*$/, "", h)
      if (h ~ /^\[[0-9A-Fa-f:.]*\]$/) return 1
      return !(index(h, "@") || index(h, ":") || index(h, "[") || index(h, "]") || index(h, " ") || index(h, "\t") || index(h, "\""))
    }
    {
      i = index($0, "://")
      if (!i) { print; next }
      head = substr($0, 1, i + 2)
      rest = substr($0, i + 3)
      authority = substr(rest, 1, upto(rest, "/?#"))
      for (last = length(authority); last > 0; last--) if (substr(authority, last, 1) == "@") break
      if (last > 0 && is_host(substr(rest, last + 1))) { print head substr(rest, last + 1); next }
      colon = index(authority, ":")
      if (colon && !index(substr(authority, 1, colon), "[")) {
        for (p = colon + 1; p <= length(rest); p++) {
          c = substr(rest, p, 1)
          if (c == "@" && is_host(substr(rest, p + 1))) { print head substr(rest, p + 1); next }
        }
      }
      if (last > 0) { print head substr(rest, last + 1); next }
      print
    }'
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
