# shellcheck shell=bash
# Von entrypoint.sh und backup-status.sh eingebunden: Ziel und Meldungen des Backups ohne Zugangsdaten, für das Log
# des Containers und die Tabelle backup_status. Gleiche Regeln wie ohneZugangsdaten in
# apps/web/src/server/modules/betrieb/restic-ziel.ts; restic-ziel.test.ts prüft beide an denselben Meldungen.

# RESTIC_REPOSITORY ohne Zugangsdaten: Nutzer und Passwort einer Adresse (credentials_from_address), den Nutzer von
# sftp:nutzer@host und die Parameter einer rclone-Verbindungszeichenkette (rclone::sftp,pass=…:pfad). Anders als in
# einer Meldung beenden Leerraum und " die Zugangsdaten hier nicht, sie gehören zum Passwort.
target_without_credentials() {
  printf '%s\n' "${RESTIC_REPOSITORY:-}" | credentials_from_address | sed -E \
    -e 's#^sftp:([^/][^/@]*)@#sftp:#' \
    -e "s#^(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^:\"'])*#\\1#"
}

# Text auf stdin ohne Zugangsdaten, etwa eine Fehlermeldung von restic: dieselben Regeln für jede Adresse bis zum
# nächsten Leerraum oder ". Steht / ? # im Passwort, kann Go (net/url, von restic genutzt) die Adresse nicht lesen, hält
# den Anfang des Passworts für den Port und schneidet bei # vor dem @ ab; aus der Meldung fallen dann Adresse und Port
# ganz weg: parse "https://nutzer:ab": invalid port ":ab" after host → parse "https://": invalid port after host.
message_without_credentials() {
  credentials_from_address meldung | sed -E \
    -e 's#(^|[^[:alnum:]_])sftp:[^/[:space:]@]+@#\1sftp:#g' \
    -e "s#(^|[^[:alnum:]_])(rclone::?[A-Za-z0-9_.-]+),(\"[^\"]*\"|'[^']*'|[^[:space:]:\"'])*#\\1\\2#g" \
    -e 's%((^|[^[:alnum:]_])parse \\?"[A-Za-z][A-Za-z0-9+.-]*://)[^"\\]*(\\?": invalid port) \\?"[^"\\]*\\?"%\1\3%g'
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
