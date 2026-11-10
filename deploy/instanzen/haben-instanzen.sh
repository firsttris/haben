#!/bin/bash
# Mehrere Instanzen von Haben nebeneinander: je Firma eine eigene Instanz mit eigener Datenbank, eigenen Belegen,
# eigenen Schlüsseln und eigenem Backup, alle hinter einem gemeinsamen Caddy (docs/installation.md, „Mehrere Instanzen“).
#
#   haben-instanzen.sh neu <name> <domain> [Optionen]   Instanz anlegen und starten
#   haben-instanzen.sh update                           alle nacheinander sichern, aktualisieren, Stopp beim ersten Fehler
#   haben-instanzen.sh status                           je Instanz Version, Erreichbarkeit, ERiC und letzte Sicherung
#   haben-instanzen.sh liste                            Name, Domain und Verzeichnis
#
# Ablage unter --basis bzw. $HABEN_INSTANZEN (Vorgabe ~/haben): je Instanz ein Verzeichnis mit compose.yml,
# compose.override.yml und .env, dazu proxy/ mit dem gemeinsamen Caddy und einer Datei je Domain in proxy/sites/.
# Braucht bash, docker mit Compose 2.23 oder neuer, openssl und curl.
set -euo pipefail

QUELLE="https://raw.githubusercontent.com/firsttris/haben/main/deploy"
NETZ="haben-proxy"
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
basis="${HABEN_INSTANZEN:-$HOME/haben}"
# Wartezeit auf eine gesunde App in Sekunden und Abstand der Prüfungen
warten="${HABEN_INSTANZEN_WARTEN:-300}"
takt="${HABEN_INSTANZEN_TAKT:-5}"

fehler() {
  echo "Fehler: $*" >&2
  exit 1
}

hilfe() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat << 'TEXT'

Optionen für neu:
  --hersteller-id ID         ELSTER_HERSTELLER_ID setzen (sonst bleibt sie leer)
  --eric-home PFAD           von Hand entpacktes ERiC einbinden, das sich alle Instanzen teilen können
  --eigener-proxy            keinen gemeinsamen Caddy starten; Netz haben-proxy anlegen und den Block für den
                             vorhandenen Proxy ausgeben
  --sso                      ausschließlich OpenID Connect, Gruppen haben-<name>-inhaber und -steuerberatung
  --oidc-issuer URL          mit --sso: Issuer des Anmeldedienstes
  --oidc-client-id ID        mit --sso: Client-ID dieser Instanz
  --oidc-client-secret WERT  mit --sso: ursprüngliches Clientsecret (kein Hash)
  --oidc-name NAME           mit --sso: Anzeigename der Anmeldung (Vorgabe Authelia)
  --nicht-starten            nur die Dateien anlegen, nichts starten
TEXT
}

# Führt einen Befehl im Verzeichnis einer Instanz aus; Compose liest dort compose.yml, die Override-Datei und .env
in_dir() {
  local dir="$1"
  shift
  (cd "$dir" && "$@")
}

# Wert eines Schlüssels aus einer .env, ohne umschließende einfache oder doppelte Anführungszeichen
env_lesen() {
  local wert
  wert="$(grep -m1 "^$2=" "$1" 2> /dev/null | cut -d= -f2-)" || true
  case "$wert" in
    \'*\') wert="${wert#\'}"; wert="${wert%\'}" ;;
    \"*\") wert="${wert#\"}"; wert="${wert%\"}" ;;
  esac
  echo "$wert"
}

# Setzt KEY=Wert in einer .env: ersetzt die erste Zeile KEY= oder # KEY=, sonst wird angehängt
env_setzen() {
  local datei="$1" tmp
  tmp="$(mktemp "$datei.XXXXXX")"
  KEY="$2" WERT="$3" awk '
    !done && ($0 ~ "^" ENVIRON["KEY"] "=" || $0 ~ "^# " ENVIRON["KEY"] "=") { print ENVIRON["KEY"] "=" ENVIRON["WERT"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["WERT"] }
  ' "$datei" > "$tmp"
  cat "$tmp" > "$datei"
  rm -f "$tmp"
}

# Ein Wert, der in einfachen Anführungszeichen in die .env kommt (Compose ersetzt darin kein $)
pruefe_woertlich() {
  case "$1" in *"'"* | *$'\n'*) fehler "$2 darf weder ' noch einen Zeilenumbruch enthalten." ;; esac
}

# Vorlage aus deploy/ neben dem Skript, sonst von GitHub
vorlage() {
  if [ -f "$HIER/../$1" ]; then
    cat "$HIER/../$1"
  else
    curl -fsSL "$QUELLE/$1" || fehler "$1 konnte nicht von $QUELLE geladen werden."
  fi
}

# Alle Instanzen unter der Basis, nach Namen sortiert, je Zeile ein Verzeichnis: compose.yml und .env mit
# COMPOSE_PROJECT_NAME=haben-<Verzeichnis> (von diesem Werkzeug) oder = <Verzeichnis>, wenn es mit haben- beginnt
# (von Hand nach der Doku angelegt)
instanzen() {
  local dir name projekt
  for dir in "$basis"/*/; do
    dir="${dir%/}"
    name="$(basename "$dir")"
    [ -f "$dir/compose.yml" ] && [ -f "$dir/.env" ] || continue
    projekt="$(env_lesen "$dir/.env" COMPOSE_PROJECT_NAME)"
    [ "$projekt" = "haben-$name" ] || { [ "$projekt" = "$name" ] && [[ "$name" == haben-* ]]; } || continue
    echo "$dir"
  done
}

caddy_block() {
  cat << CADDY
$1 {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy same-origin
		X-Frame-Options SAMEORIGIN
	}
	# Uploads: Archivdateien bis 100 MB, Belege bis 20 MB je Datei; mehrere Dateien gehen in einer Anfrage
	request_body {
		max_size 250MB
	}
	reverse_proxy haben-$2:3000
}
CADDY
}

proxy_anlegen() {
  local dir="$basis/proxy"
  mkdir -p "$dir/sites"
  [ -f "$dir/Caddyfile" ] || printf '# Eine Datei je Instanz, angelegt von haben-instanzen.sh\nimport sites/*.caddy\n' > "$dir/Caddyfile"
  [ -f "$dir/compose.yml" ] || cat > "$dir/compose.yml" << 'YAML'
# Gemeinsamer Caddy für alle Instanzen von Haben, angelegt von haben-instanzen.sh
name: haben-proxy
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - caddy:/data
    networks: [proxy]
networks:
  proxy:
    name: haben-proxy
volumes:
  caddy:
YAML
}

# Startet den gemeinsamen Caddy (legt dabei das Netz an); läuft er schon, liest er seine Konfiguration neu ein
proxy_starten() {
  if laeuft "$basis/proxy" caddy; then
    in_dir "$basis/proxy" docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  else
    in_dir "$basis/proxy" docker compose up -d
  fi
}

# Wartet, bis die App gesund ist; bricht ab, sobald sie beendet ist oder neu startet (etwa nach einer Migration mit Fehler)
warten_auf_app() {
  local dir="$1" zustand i=0 schritte=$((warten / (takt > 0 ? takt : 1)))
  while [ "$i" -le "$schritte" ]; do
    zustand="$(in_dir "$dir" docker compose ps -a --format '{{.State}} {{.Health}}' app 2> /dev/null || true)"
    case "$zustand" in
      "running healthy") return 0 ;;
      exited* | dead* | restarting*) return 1 ;;
    esac
    sleep "$takt"
    i=$((i + 1))
  done
  return 1
}

# 0: der Dienst läuft, 1: er läuft nicht, 2: Compose meldet einen Fehler (etwa eine fehlerhafte .env). Erst die
# ganze Ausgabe, dann suchen: grep -q in einer Pipe mit pipefail ließe docker an SIGPIPE scheitern
laeuft() {
  local dienste
  dienste="$(in_dir "$1" docker compose ps --status running --services 2> /dev/null)" || return 2
  grep -qx "$2" <<< "$dienste"
}

cmd_neu() {
  [ $# -ge 2 ] || fehler "Aufruf: haben-instanzen.sh neu <name> <domain> [Optionen]"
  local name="$1" domain="$2"
  shift 2
  local hersteller="" eric_home="" eigener_proxy=0 sso=0 starten=1 issuer="" client_id="" client_secret="" oidc_name="Authelia"
  while [ $# -gt 0 ]; do
    case "$1" in
      --hersteller-id) hersteller="${2:?--hersteller-id braucht einen Wert}"; shift ;;
      --eric-home) eric_home="${2:?--eric-home braucht einen Pfad}"; shift ;;
      --eigener-proxy) eigener_proxy=1 ;;
      --sso) sso=1 ;;
      --oidc-issuer) issuer="${2:?--oidc-issuer braucht einen Wert}"; shift ;;
      --oidc-client-id) client_id="${2:?--oidc-client-id braucht einen Wert}"; shift ;;
      --oidc-client-secret) client_secret="${2:?--oidc-client-secret braucht einen Wert}"; shift ;;
      --oidc-name) oidc_name="${2:?--oidc-name braucht einen Wert}"; shift ;;
      --nicht-starten) starten=0 ;;
      *) fehler "Unbekannte Option: $1" ;;
    esac
    shift
  done

  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || fehler "Name nur aus a–z, 0–9 und -, beginnend mit Buchstabe oder Ziffer, höchstens 31 Zeichen: $name"
  [ "$name" != proxy ] || fehler "Der Name proxy ist für den gemeinsamen Caddy reserviert."
  [[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fehler "Domain ohne https:// und ohne Pfad, klein geschrieben, z. B. firma1.example.de: $domain"
  [ -z "$hersteller" ] || [[ "$hersteller" =~ ^[0-9]{1,10}$ ]] || fehler "Die Hersteller-ID besteht nur aus Ziffern."
  [ -z "$eric_home" ] || [[ "$eric_home" =~ ^/[A-Za-z0-9._/-]+$ ]] || fehler "--eric-home braucht einen absoluten Pfad ohne Leerzeichen."
  if [ "$sso" = 1 ]; then
    [ -n "$issuer" ] && [ -n "$client_id" ] && [ -n "$client_secret" ] || fehler "--sso braucht --oidc-issuer, --oidc-client-id und --oidc-client-secret."
    [[ "$issuer" =~ ^https:// ]] || fehler "--oidc-issuer muss mit https:// beginnen."
    pruefe_woertlich "$issuer" --oidc-issuer
    pruefe_woertlich "$client_id" --oidc-client-id
    pruefe_woertlich "$client_secret" --oidc-client-secret
    pruefe_woertlich "$oidc_name" --oidc-name
  elif [ -n "$issuer$client_id$client_secret" ]; then
    fehler "--oidc-… nur zusammen mit --sso."
  fi

  local dir="$basis/$name" andere projekte
  # Vorhandenes bleibt unangetastet, vor allem .env und Schlüssel
  [ ! -e "$dir" ] || fehler "$dir gibt es schon; nichts geändert."
  while IFS= read -r andere <&3; do
    [ "$(env_lesen "$andere/.env" DOMAIN)" != "$domain" ] || fehler "Die Domain $domain gehört schon zur Instanz $(basename "$andere")."
    # Gleiches Projekt hieße gleiche Container, Volumes und gleicher Name im Netz des Proxys, etwa bei einer
    # Instanz haben-firma1, die von Hand nach der Doku angelegt ist
    [ "$(env_lesen "$andere/.env" COMPOSE_PROJECT_NAME)" != "haben-$name" ] \
      || fehler "Das Compose-Projekt haben-$name gehört schon zur Instanz $andere; bitte einen anderen Namen wählen."
  done 3< <(instanzen)
  # Auch ein Projekt dieses Namens außerhalb der Basis, solange docker es kennt
  if projekte="$(docker compose ls -a -q 2> /dev/null)"; then
    ! grep -qx "haben-$name" <<< "$projekte" || fehler "Docker kennt schon ein Compose-Projekt haben-$name; bitte einen anderen Namen wählen."
  fi
  command -v openssl > /dev/null || fehler "openssl fehlt."

  mkdir -p "$basis"
  local neu
  neu="$(mktemp -d "$basis/.neu-$name.XXXXXX")"
  # Bricht etwas ab, bleibt kein halbes Verzeichnis zurück
  NEU_TMP="$neu"
  trap 'rm -rf "$NEU_TMP"' EXIT
  vorlage compose.yml > "$neu/compose.yml"
  vorlage compose.env.example > "$neu/.env"
  chmod 600 "$neu/.env"

  local e="$neu/.env"
  env_setzen "$e" COMPOSE_PROJECT_NAME "haben-$name"
  env_setzen "$e" DOMAIN "$domain"
  env_setzen "$e" DB_PASSWORD "$(openssl rand -hex 24)"
  env_setzen "$e" AUTH_SECRET "$(openssl rand -base64 32)"
  env_setzen "$e" ENCRYPTION_KEY "$(openssl rand -base64 32)"
  env_setzen "$e" RESTIC_PASSWORD "$(openssl rand -base64 32)"
  # Eigener Name je Instanz, falls sich mehrere ein restic-Repository teilen
  env_setzen "$e" BACKUP_HOST "haben-$name"
  [ -z "$hersteller" ] || env_setzen "$e" ELSTER_HERSTELLER_ID "$hersteller"
  [ -z "$eric_home" ] || env_setzen "$e" ERIC_HOME "$eric_home"
  if [ "$sso" = 1 ]; then
    env_setzen "$e" OIDC_ONLY true
    env_setzen "$e" OIDC_ISSUER "'$issuer'"
    env_setzen "$e" OIDC_CLIENT_ID "'$client_id'"
    env_setzen "$e" OIDC_CLIENT_SECRET "'$client_secret'"
    env_setzen "$e" OIDC_DISPLAY_NAME "'$oidc_name'"
    # Eindeutig je Instanz: Teilen sich Instanzen einen Anmeldedienst, wäre jedes Mitglied einer gemeinsamen
    # Inhaber-Gruppe Inhaber in allen Firmen
    env_setzen "$e" OIDC_GROUP_INHABER "haben-$name-inhaber"
    env_setzen "$e" OIDC_GROUP_STEUERBERATUNG "haben-$name-steuerberatung"
  fi

  {
    echo "# Angelegt von haben-instanzen.sh: eigener Caddy aus, App im Netz $NETZ als haben-$name:3000"
    echo "services:"
    echo "  caddy:"
    echo "    profiles: [eigener-proxy]"
    echo "  app:"
    echo "    networks:"
    echo "      default:"
    echo "      proxy:"
    echo "        aliases: [haben-$name]"
    if [ -n "$eric_home" ]; then
      echo "    volumes:"
      echo "      - $eric_home:$eric_home:ro"
    fi
    echo "networks:"
    echo "  proxy:"
    echo "    external: true"
    echo "    name: $NETZ"
  } > "$neu/compose.override.yml"

  mv "$neu" "$dir"
  trap - EXIT
  echo "Angelegt: $dir"
  echo "ENCRYPTION_KEY und RESTIC_PASSWORD aus $dir/.env zusätzlich an einem zweiten Ort sichern (Passwortmanager)."

  if [ "$eigener_proxy" = 1 ]; then
    echo
    echo "Für deinen Proxy (Container im Netz $NETZ, z. B. docker network connect $NETZ <proxy>):"
    caddy_block "$domain" "$name"
  else
    proxy_anlegen
    caddy_block "$domain" "$name" > "$basis/proxy/sites/$name.caddy"
  fi

  if [ "$sso" = 1 ]; then
    echo
    echo "Im Anmeldedienst: Gruppen haben-$name-inhaber und haben-$name-steuerberatung anlegen, Client $client_id mit"
    echo "  redirect_uris: [https://$domain/api/auth/callback/oidc]"
    echo "(vollständiges Beispiel für Authelia: docs/installation.md, „Authelia konfigurieren“)."
  fi

  [ "$starten" = 1 ] || { echo "Nicht gestartet (--nicht-starten). Später: cd $dir && docker compose up -d"; return 0; }
  if [ "$eigener_proxy" = 1 ]; then
    docker network inspect "$NETZ" > /dev/null 2>&1 || docker network create "$NETZ" > /dev/null
  else
    proxy_starten
  fi
  in_dir "$dir" docker compose up -d
  warten_auf_app "$dir" || fehler "Die App von $name ist nicht gesund geworden; siehe: cd $dir && docker compose logs app"
  echo
  if [ "$sso" = 1 ]; then
    echo "Fertig. Einrichten: https://$domain/setup, angemeldet als Mitglied von haben-$name-inhaber."
  else
    in_dir "$dir" docker compose logs app 2> /dev/null | grep "Einrichtungscode" | tail -n 1 | sed 's/^[^|]*| //' || true
    echo "Fertig. Einrichten: https://$domain/setup mit dem Einrichtungscode."
  fi
}

cmd_update() {
  local dir name uebersprungen=""
  # Die Liste über Kanal 3: docker compose exec liest sonst den Rest aus der Standardeingabe
  while IFS= read -r dir <&3; do
    name="$(basename "$dir")"
    echo "== $name"
    if laeuft "$dir" app; then
      :
    elif [ $? -eq 2 ]; then
      fehler "$name: docker compose meldet einen Fehler (cd $dir && docker compose ps); $name und die folgenden Instanzen sind nicht aktualisiert."
    else
      echo "gestoppt, übersprungen"
      uebersprungen="$uebersprungen $name"
      continue
    fi
    in_dir "$dir" docker compose exec -T backup backup.sh || fehler "$name: Sicherung vor dem Update fehlgeschlagen; $name und die folgenden Instanzen sind nicht aktualisiert."
    in_dir "$dir" docker compose pull || fehler "$name: Images konnten nicht geladen werden; $name und die folgenden Instanzen sind nicht aktualisiert."
    in_dir "$dir" docker compose up -d || fehler "$name: Start fehlgeschlagen; die folgenden Instanzen sind nicht aktualisiert."
    warten_auf_app "$dir" \
      || fehler "$name: Die App ist nach dem Update nicht gesund (etwa eine fehlgeschlagene Migration); siehe: cd $dir && docker compose logs app. Die folgenden Instanzen sind nicht aktualisiert."
    echo "aktualisiert"
  done 3< <(instanzen)
  [ -z "$uebersprungen" ] || echo "Nicht aktualisiert, weil gestoppt:$uebersprungen"
}

cmd_status() {
  local dir name domain version erreichbar eric sicherung code
  printf '%-20s %-32s %-10s %-11s %-12s %s\n' Instanz Domain Version Erreichbar ERiC "Letzte Sicherung"
  while IFS= read -r dir <&3; do
    name="$(basename "$dir")"
    domain="$(env_lesen "$dir/.env" DOMAIN)"
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$domain/login" 2> /dev/null || true)"
    if [ "$code" = 200 ]; then erreichbar=ja; else erreichbar="nein (${code:-000})"; fi
    if laeuft "$dir" app; then
      version="$(in_dir "$dir" docker compose exec -T app bun -e 'console.log(require("/app/package.json").version)' 2> /dev/null || echo "?")"
      # Version des heruntergeladenen ERiC (AKTUELL zeigt auf den Ordner) oder des von Hand eingebundenen
      eric="$(in_dir "$dir" docker compose exec -T app sh -c 'd="${ERIC_HOME:-}"; if [ -z "$d" ] && a="$(cat /var/lib/haben/eric/AKTUELL 2> /dev/null)"; then d="/var/lib/haben/eric/$a"; fi
        if [ -f "$d/HABEN_ERIC_VERSION" ]; then cat "$d/HABEN_ERIC_VERSION"; elif [ -n "${ERIC_HOME:-}" ]; then echo "von Hand"; else echo fehlt; fi' 2> /dev/null || echo "?")"
    elif [ $? -eq 2 ]; then
      version=Fehler
      eric="–"
    else
      version=gestoppt
      eric="–"
    fi
    if laeuft "$dir" db; then
      sicherung="$(in_dir "$dir" docker compose exec -T db psql -U haben -d haben -XAtc \
        "SELECT coalesce(to_char(max(at) AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI'), 'keine') FROM backup_status WHERE kind = 'backup' AND ok" \
        2> /dev/null || echo "?")"
    else
      sicherung="– (Datenbank gestoppt)"
    fi
    printf '%-20s %-32s %-10s %-11s %-12s %s\n' "$name" "$domain" "$version" "$erreichbar" "$eric" "$sicherung"
  done 3< <(instanzen)
}

cmd_liste() {
  local dir
  while IFS= read -r dir; do
    printf '%-20s %-32s %s\n' "$(basename "$dir")" "$(env_lesen "$dir/.env" DOMAIN)" "$dir"
  done < <(instanzen)
}

while [ $# -gt 0 ]; do
  case "$1" in
    --basis) basis="${2:?--basis braucht ein Verzeichnis}"; shift 2 ;;
    -h | --help | hilfe) hilfe; exit 0 ;;
    *) break ;;
  esac
done
befehl="${1:-}"
[ $# -eq 0 ] || shift
case "$befehl" in
  neu) cmd_neu "$@" ;;
  update) cmd_update ;;
  status) cmd_status ;;
  liste) cmd_liste ;;
  "") hilfe; exit 1 ;;
  *) fehler "Unbekannter Befehl: $befehl (neu, update, status, liste)" ;;
esac
