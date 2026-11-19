# shellcheck shell=bash
# Von entrypoint.sh eingebunden: Ziele, die restic nicht selbst spricht, gehen über rclone (WebDAV, OneDrive, SMB …).
# restic startet dafür die Binärdatei rclone und liest ihre Konfiguration aus RCLONE_CONFIG. Ohne diese Datei endet
# ein Ziel der Form rclone:name:pfad mit „exec: rclone: executable file not found“ oder „didn't find section in
# config file“.
#
# Beispiel für Nextcloud im eigenen Netz:
#   RESTIC_REPOSITORY=rclone:webdav:haben
#   RCLONE_WEBDAV_URL=https://cloud.example.de/remote.php/dav/files/nutzer/haben
#   RCLONE_WEBDAV_USER=nutzer
#   RCLONE_WEBDAV_PASS=<Passwort im Klartext, wird beim Start verschleiert>
#   RCLONE_WEBDAV_VENDOR=nextcloud      (wahlweise; ohne Angabe gilt other)
#
# Die Variablen heißen wie rclones eigene Umgebungs-Konfiguration (RCLONE_<ABSCHNITT>_<SCHLÜSSEL>). rclone würde
# RCLONE_WEBDAV_PASS deshalb als bereits verschleiertes Passwort lesen und mit „input too short when revealing
# password“ abbrechen. configure_rclone entfernt die vier Variablen nach dem Schreiben, damit allein die Datei gilt.
#
# Das Passwort steht in der rclone-Konfiguration verschleiert (rclone obscure). Das ist Verschleierung, keine
# Verschlüsselung: Wer die Datei liest, kommt an das Passwort. Deshalb liegt sie auf 600 und wird nie geloggt.

# Pfad der erzeugten Konfiguration; RESTIC_REPOSITORY verweist auf den Abschnitt, nicht auf diese Datei
rclone_config_file() {
  printf '%s\n' "${RCLONE_CONFIG:-/var/lib/haben-backup/rclone.conf}"
}

# Name des Abschnitts in der Konfiguration, Vorgabe webdav, damit rclone:webdav:haben ohne weiteres Zutun passt
rclone_remote_name() {
  printf '%s\n' "${RCLONE_REMOTE_NAME:-webdav}"
}

uses_rclone() {
  case "${RESTIC_REPOSITORY:-}" in
    rclone:*) return 0 ;;
    *) return 1 ;;
  esac
}

# Adresse ohne Zugangsdaten, falls jemand sie in die URL geschrieben hat, für Log und Fehlermeldung
rclone_url_without_credentials() {
  printf '%s\n' "$1" | sed -E 's#(^[A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@#\1#'
}

# Schreibt die Konfiguration und setzt RCLONE_CONFIG, falls das Ziel über rclone läuft. Bricht mit einer Meldung
# ab, die den Abschnitt und die fehlende Variable nennt, statt restic mit einer unverständlichen Zeile scheitern
# zu lassen.
configure_rclone() {
  uses_rclone || return 0
  local bin="${RCLONE_BIN:-rclone}"
  local conf name url user pass vendor tmp
  conf="$(rclone_config_file)"
  name="$(rclone_remote_name)"
  url="${RCLONE_WEBDAV_URL:-}"
  user="${RCLONE_WEBDAV_USER:-}"
  pass="${RCLONE_WEBDAV_PASS:-}"
  vendor="${RCLONE_WEBDAV_VENDOR:-}"

  command -v "$bin" > /dev/null 2>&1 || {
    echo "RESTIC_REPOSITORY nutzt rclone ($RESTIC_REPOSITORY), aber $bin ist im Image nicht vorhanden." >&2
    exit 2
  }
  [ -n "$url" ] || {
    echo "RESTIC_REPOSITORY nutzt rclone, aber RCLONE_WEBDAV_URL fehlt. Beispiel: RCLONE_WEBDAV_URL=https://cloud.example.de/remote.php/dav/files/nutzer/haben" >&2
    exit 2
  }
  case "$url" in
    *://*@*)
      echo "RCLONE_WEBDAV_URL enthält Zugangsdaten. Trag sie als RCLONE_WEBDAV_USER und RCLONE_WEBDAV_PASS ein, sonst stehen sie im Log und in der Konfigurationsdatei." >&2
      exit 2
      ;;
  esac
  [ -n "$user" ] || {
    echo "RESTIC_REPOSITORY nutzt rclone, aber RCLONE_WEBDAV_USER fehlt." >&2
    exit 2
  }
  [ -n "$pass" ] || {
    echo "RESTIC_REPOSITORY nutzt rclone, aber RCLONE_WEBDAV_PASS fehlt." >&2
    exit 2
  }

  case "$RESTIC_REPOSITORY" in
    "rclone:$name:"*) ;;
    rclone::*)
      echo "RESTIC_REPOSITORY nennt die Zugangsdaten in der Adresse. Trag sie als RCLONE_WEBDAV_URL, RCLONE_WEBDAV_USER und RCLONE_WEBDAV_PASS ein und schreib rclone:$name:<pfad>, sonst stehen sie im Log." >&2
      exit 2
      ;;
    *)
      echo "RESTIC_REPOSITORY verweist auf einen anderen Abschnitt als ${name}: ${RESTIC_REPOSITORY}. Passend wäre rclone:$name:<pfad> oder RCLONE_REMOTE_NAME auf den Abschnitt setzen." >&2
      exit 2
      ;;
  esac

  mkdir -p "$(dirname "$conf")"
  tmp="$conf.tmp"
  # pass kommt verschleiert in die Datei; der Klartext steht danach nur noch in der Umgebung dieses Prozesses
  {
    printf '[%s]\n' "$name"
    printf 'type = webdav\n'
    printf 'url = %s\n' "$url"
    printf 'user = %s\n' "$user"
    printf 'pass = %s\n' "$("$bin" obscure "$pass")"
    [ -z "$vendor" ] || printf 'vendor = %s\n' "$vendor"
  } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$conf"
  unset RCLONE_WEBDAV_URL RCLONE_WEBDAV_USER RCLONE_WEBDAV_PASS RCLONE_WEBDAV_VENDOR
  export RCLONE_CONFIG="$conf"
  echo "rclone: Ziel $name auf $(rclone_url_without_credentials "$url"), Konfiguration unter $conf"
}
