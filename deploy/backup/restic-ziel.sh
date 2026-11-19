# shellcheck shell=bash
# Von entrypoint.sh und backup-status.sh eingebunden: Ziel und Meldungen des Backups ohne Zugangsdaten, für das Log
# des Containers und die Tabelle backup_status. Gleiche Regeln wie ohneZugangsdaten in
# apps/web/src/server/modules/betrieb/restic-ziel.ts; restic-ziel.test.ts prüft beide an denselben Meldungen.

# Läuft das Ziel über rclone, und welchen Abschnitt nennt die Adresse? Diese Datei ist die einzige, die
# RESTIC_REPOSITORY liest (restic-ziel.test.ts, #1349); rclone-ziel.sh fragt hier.
ziel_ist_rclone() {
  case "${RESTIC_REPOSITORY:-}" in
    rclone:*) return 0 ;;
    *) return 1 ;;
  esac
}

# Abschnitt aus rclone:<abschnitt>:<pfad>. Die Form rclone::<typ>,<parameter>:<pfad> bringt alles selbst mit und
# braucht keine Datei; dann bleibt der Name leer. Parameter hinter dem Abschnitt (rclone:<abschnitt>,pass=…:<pfad>,
# rclone-Doku „Connection strings“) gehören nicht zum Namen und nicht ins Log.
rclone_ziel_abschnitt() {
  case "${RESTIC_REPOSITORY:-}" in
    rclone::*) printf '' ;;
    rclone:*) printf '%s' "${RESTIC_REPOSITORY#rclone:}" | cut -d: -f1 | cut -d, -f1 ;;
  esac
}

# RESTIC_REPOSITORY ohne Zugangsdaten: Nutzer und Passwort einer Adresse (credentials_from_address), den Nutzer von
# sftp:nutzer@host und die Parameter einer rclone-Verbindungszeichenkette (rclone::sftp,pass=…:pfad). Anders als in
# einer Meldung beenden Leerraum und " die Zugangsdaten hier nicht, sie gehören zum Passwort.
target_without_credentials() {
  printf '%s\n' "${RESTIC_REPOSITORY:-}" | credentials_from_address | sed -E \
    -e 's#^sftp:([^/][^/@]*)@#sftp:#' \
    -e "s#^(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^:\"'])*#\\1#"
}

# Text auf stdin ohne Zugangsdaten, etwa eine Fehlermeldung von restic: dieselben Regeln für jede Adresse bis zum
# nächsten Leerraum oder ". Kann Go (net/url, von restic genutzt) die Adresse nicht lesen, etwa bei / ? # Leerraum " oder
# Umlauten im Passwort, nennt seine Meldung sie in Go-Schreibweise samt Passwort, dazu Teile davon als Port oder Escape:
# parse "https://nutzer:ab cd@host/": net/url: invalid userinfo, parse "https://nutzer:ab": invalid port ":ab" after host.
# Daraus fallen Adresse und diese Teile ganz weg: parse "https://": net/url: invalid userinfo. sftp: und rclone: zählen
# auch direkt hinter \n, wie in der JSON-Meldung von restic --json („unable to open config file: …\nrclone::sftp,…“).
message_without_credentials() {
  credentials_from_address meldung | sed -E \
    -e 's#(^|[^[:alnum:]_]|\\[nrt])sftp:[^/[:space:]@]+@#\1sftp:#g' \
    -e "s#(^|[^[:alnum:]_]|\\\\[nrt])(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^[:space:]:\"'])*#\\1\\2#g" \
    -e 's%((^|[^[:alnum:]_])parse \\?"[A-Za-z][A-Za-z0-9+.-]*://)([^"\\]|\\.)*(\\?": )%\1\4%g' \
    -e 's%(invalid (port|URL escape|character)) \\?"([^"\\]|\\.)*\\?"%\1%g'
}

# Fehlerausgabe eines Laufs ohne Zugangsdaten (backup.sh und restore-check.sh leiten ihren stderr hier durch). Zeile für
# Zeile, weil awk und sed in einer Pipe puffern: Eine Meldung käme sonst erst am Ende des Laufs im Log an.
stream_without_credentials() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    message_without_credentials <<< "$line"
  done
}

# Legt das Repository an (backup.sh beim ersten Lauf). Auch die Ausgabe von restic init läuft durch den Filter: restic
# nennt das Repository dort über location.StripPassword, das für sftp:, s3: und rclone: die Adresse unverändert lässt
# (location.NoPassword) und für rest: den Nutzer zeigt (restic 0.19.1, cmd/restic/cmd_init.go).
init_repository() {
  local out
  echo "Lege das restic-Repository $(target_without_credentials) an …"
  if ! out="$(restic init 2>&1)"; then
    message_without_credentials <<< "$out" >&2
    return 1
  fi
  message_without_credentials <<< "$out"
}

# Nutzer und Passwort einer Adresse nach ://: wie bei Go url.Parse in restic bis zum letzten @ vor Pfad und Abfrage,
# wenn danach ein Host folgt. Hat dieser Teil kein @, steht oft ein Passwort mit unkodiertem / davor: dann nach nutzer:
# bis zum ersten @, auf das ein Host folgt. Folgt keinem @ ein Host, aber die Authority hat eins, fällt sie bis dorthin
# trotzdem weg: lieber ein falsches Ziel als ein Passwort. Ohne nutzer: und ohne @ in der Authority bleibt ein @ im Pfad
# stehen (rest:https://h/haben@2026). Ohne Argument ist jede Zeile ein Ziel mit einer Adresse; mit „meldung“ zählt jede
# Adresse der Zeile, jeweils bis zum nächsten Leerraum oder ". Nur POSIX-awk ohne Zeichenklassen, damit mawk, gawk und
# busybox gleich rechnen.
credentials_from_address() {
  awk -v meldung="${1:-}" '
    # Länge von s vor dem ersten Zeichen aus stop
    function upto(s, stop,   i) {
      for (i = 1; i <= length(s); i++) if (index(stop, substr(s, i, 1))) return i - 1
      return length(s)
    }
    # Beginnt s mit einem Host samt optionalem Port: [IPv6] oder ohne @ : [ ] Leerraum und "? Leerraum und " am Ende
    # gehören nicht zum Host (rest:https://u:p@host "…), ebenso ein Doppelpunkt hinter dem Port am Ende einer Adresse
    # in einer Meldung (unable to open repository at rest:https://u:p@host:8000: …).
    function is_host(s,   h) {
      h = substr(s, 1, upto(s, "/?#\\"))
      sub(/[ \t"]+$/, "", h)
      if (!sub(/:[0-9]+:$/, "", h)) sub(/:[0-9]*$/, "", h)
      if (h ~ /^\[[0-9A-Fa-f:.]*\]$/) return 1
      return !(index(h, "@") || index(h, ":") || index(h, "[") || index(h, "]") || index(h, " ") || index(h, "\t") || index(h, "\""))
    }
    # rest ist der Teil hinter ://, zurück kommt er ohne Nutzer und Passwort
    function strip(rest,   authority, last, colon, p) {
      authority = substr(rest, 1, upto(rest, "/?#"))
      for (last = length(authority); last > 0; last--) if (substr(authority, last, 1) == "@") break
      if (last > 0 && is_host(substr(rest, last + 1))) return substr(rest, last + 1)
      colon = index(authority, ":")
      if (colon && !index(substr(authority, 1, colon), "[")) {
        for (p = colon + 1; p <= length(rest); p++)
          if (substr(rest, p, 1) == "@" && is_host(substr(rest, p + 1))) return substr(rest, p + 1)
      }
      if (last > 0) return substr(rest, last + 1)
      return rest
    }
    !meldung {
      i = index($0, "://")
      if (!i) { print; next }
      print substr($0, 1, i + 2) strip(substr($0, i + 3))
      next
    }
    {
      out = ""
      line = $0
      while ((i = index(line, "://")) > 0) {
        out = out substr(line, 1, i + 2)
        line = substr(line, i + 3)
        n = upto(line, " \t\"")
        line = strip(substr(line, 1, n)) substr(line, n + 1)
      }
      print out line
    }'
}
