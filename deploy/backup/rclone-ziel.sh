# shellcheck shell=bash
# Von entrypoint.sh eingebunden: Ziele, die restic nicht selbst spricht, gehen über rclone. Haben baut dabei keine
# Zieltypen nach: entscheidend ist allein die rclone-Konfiguration. Damit funktioniert jedes Ziel, das rclone kennt,
# ohne dass Haben es namentlich führen muss, etwa WebDAV, OneDrive, Google Drive, Dropbox, Box, pCloud, SMB, SFTP.
#
# Gesucht wird die Konfiguration in dieser Reihenfolge:
#   1. RCLONE_CONFIG, so gesetzt (rclone selbst liest die Variable auch)
#   2. /var/lib/haben-backup/rclone.conf, etwa als eingehängte Datei
# Ein Repository nennt nur den Abschnitt daraus: RESTIC_REPOSITORY=rclone:<abschnitt>:<pfad>.
#
# Die Datei enthält Zugangsdaten (bei OneDrive einen OAuth-Token, bei WebDAV das Passwort verschleiert). Sie gehört
# auf 600 und nicht ins Repository.

rclone_config_file() {
  printf '%s\n' "${RCLONE_CONFIG:-/var/lib/haben-backup/rclone.conf}"
}

uses_rclone() {
  case "${RESTIC_REPOSITORY:-}" in
    rclone:*) return 0 ;;
    *) return 1 ;;
  esac
}

# Abschnitt aus rclone:<abschnitt>:<pfad>. Die Form rclone::<typ>,<parameter>:<pfad> bringt alles selbst mit und
# braucht keine Datei; dann bleibt der Name leer.
rclone_remote_name() {
  case "${RESTIC_REPOSITORY:-}" in
    rclone::*) printf '' ;;
    rclone:*) printf '%s' "${RESTIC_REPOSITORY#rclone:}" | cut -d: -f1 ;;
  esac
}

# Prüft vor dem Start, dass rclone da ist und die Konfiguration den Abschnitt kennt, statt restic mit einer Meldung
# wie „didn't find section in config file" scheitern zu lassen. Gibt nichts aus, was in der Datei steht.
#
# Der Abschnitt wird über `rclone listremotes` geprüft: `rclone config show <name>` endet auch für einen Abschnitt,
# den die Datei nicht enthält, mit 0 (rclone 1.76.0, cmd/config/config.go), taugt also nicht als Prüfung.
configure_rclone() {
  uses_rclone || return 0
  # Einstiegspunkt und die Skripte rufen die Prüfung beide auf; die Meldung soll einmal erscheinen
  [ "${RCLONE_ZIEL_GEPRUEFT:-}" = 1 ] && return 0
  local bin conf name mode
  bin="${RCLONE_BIN:-rclone}"
  conf="$(rclone_config_file)"
  command -v "$bin" > /dev/null 2>&1 || {
    echo "RESTIC_REPOSITORY nutzt rclone ($RESTIC_REPOSITORY), aber $bin ist im Image nicht vorhanden." >&2
    exit 2
  }
  name="$(rclone_remote_name)"
  [ -n "$name" ] || return 0
  [ -r "$conf" ] || {
    echo "RESTIC_REPOSITORY nutzt den rclone-Abschnitt ${name}, aber es gibt keine Konfiguration: $conf fehlt. Die Datei einhängen oder RCLONE_CONFIG auf ihren Pfad setzen; ein Beispiel steht in docs/installation-backup.md." >&2
    exit 2
  }
  if mode="$(stat -c %a "$conf" 2>/dev/null)" && [ -n "$mode" ] && [ $((mode % 100)) -ne 0 ]; then
    echo "Hinweis: $conf ist für Gruppe oder andere lesbar ($mode) und enthält Zugangsdaten. chmod 600 empfohlen." >&2
  fi
  export RCLONE_CONFIG="$conf"
  export RCLONE_ZIEL_GEPRUEFT=1
  # listremotes gibt je Abschnitt eine Zeile „name:" aus; ein Abschnitt, den die Datei nicht enthält, fehlt darin
  if ! "$bin" listremotes 2>/dev/null | grep -qxF "${name}:"; then
    echo "Der rclone-Abschnitt ${name} fehlt in $conf. Vorhandene Abschnitte zeigt rclone listremotes." >&2
    exit 2
  fi
  echo "rclone: Ziel ${name} aus ${conf}"
}
