#!/usr/bin/env bash
# Start des Datenbank-Containers von Haben: hebt einen Datenbestand einer älteren PostgreSQL-Version
# mit pg_upgrade auf die Version des Images und startet dann wie das offizielle postgres-Image.
#
# Wo die Daten liegen:
# - Volume unter /var/lib/postgresql/data (compose.yml und Quadlet von Haben): je Version
#   <Version>/docker im Volume. Mit postgres:16 lagen die Daten direkt im Volume; das erste Upgrade
#   räumt sie nach 16/docker.
# - Volume unter /var/lib/postgresql (Vorgabe des postgres-Images ab 18): je Version <Version>/docker.
#
# Der alte Bestand bleibt unverändert erhalten (pg_upgrade --copy) und liegt danach in
# <alte Version>/docker. Schlägt das Upgrade fehl, bleibt alles, wie es war: Das alte Image (etwa
# postgres:16) startet mit demselben Volume wie vorher.
set -Eeuo pipefail

log() { echo "haben-db: $*" >&2; }

# Nur beim Start des Servers, nicht bei `docker run … haben-db psql` und Ähnlichem
if [ "${1:-postgres}" != postgres ] && [ "${1:0:1}" != - ]; then
  exec docker-entrypoint.sh "$@"
fi

if grep -q ' /var/lib/postgresql/data ' /proc/self/mountinfo; then
  base=/var/lib/postgresql/data
else
  base=/var/lib/postgresql
fi
export PGDATA="$base/$PG_MAJOR/docker"

# Neuester Bestand einer älteren Version: direkt im Volume (alte Anordnung) oder in <Version>/docker
find_old() {
  local d v best="" best_v=0
  for d in "$base" "$base"/*/docker; do
    [ -s "$d/PG_VERSION" ] || continue
    v="$(cat "$d/PG_VERSION")"
    [[ "$v" =~ ^[0-9]+$ ]] || continue
    if [ "$v" -lt "$PG_MAJOR" ] && [ "$v" -gt "$best_v" ]; then
      best="$d"
      best_v="$v"
    fi
  done
  [ -n "$best" ] && echo "$best_v $best"
}

upgrade() {
  local old_v="$1" old="$2"
  local oldbin="/usr/lib/postgresql/$old_v/bin" newbin="/usr/lib/postgresql/$PG_MAJOR/bin"
  local su="${POSTGRES_USER:-postgres}"
  if [ ! -x "$oldbin/pg_ctl" ]; then
    log "In $old liegt eine Datenbank von PostgreSQL $old_v; dieses Image aktualisiert erst ab $(ls /usr/lib/postgresql | sort -n | head -n 1)."
    log "Bitte zuerst über ein älteres Image von haben-db gehen oder aus dem Backup wiederherstellen."
    exit 1
  fi
  log "Aktualisiere die Datenbank von PostgreSQL $old_v ($old) auf $PG_MAJOR ($PGDATA) …"

  local work
  work="$(mktemp -d)"
  chown postgres:postgres "$work"
  as_pg() { gosu postgres "$@"; }

  # Alten Server einmal kurz starten: holt einen nicht sauber beendeten Lauf nach (pg_upgrade braucht
  # einen sauber heruntergefahrenen Bestand) und liefert Kodierung und Locale für den neuen Cluster.
  # Nur über einen Socket im Arbeitsverzeichnis erreichbar, nicht über das Netz.
  as_pg "$oldbin/pg_ctl" -D "$old" -w -l "$work/alt.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$work'" start > /dev/null \
    || { cat "$work/alt.log" >&2; log "Der Server von PostgreSQL $old_v startet nicht; nichts geändert."; exit 1; }
  local locale_col="daticulocale"
  [ "$old_v" -lt 17 ] || locale_col="datlocale"
  local info
  info="$(as_pg "$oldbin/psql" -X -A -t -F '|' -h "$work" -U "$su" -d template1 -c \
    "SELECT pg_encoding_to_char(encoding), datcollate, datctype, datlocprovider, coalesce($locale_col, '')
       FROM pg_database WHERE datname = 'template0'")" \
    || { as_pg "$oldbin/pg_ctl" -D "$old" -w -m fast stop > /dev/null; log "Abfrage am alten Server fehlgeschlagen; nichts geändert."; exit 1; }
  as_pg "$oldbin/pg_ctl" -D "$old" -w -m fast stop > /dev/null
  local enc collate ctype provider loc
  IFS='|' read -r enc collate ctype provider loc <<< "$info"

  local args=(--username="$su" --encoding="$enc" --lc-collate="$collate" --lc-ctype="$ctype")
  case "$provider" in
    i) args+=(--locale-provider=icu --icu-locale="$loc") ;;
    b) args+=(--locale-provider=builtin --builtin-locale="$loc") ;;
  esac
  # Prüfsummen wie im alten Bestand; postgres:16 legte ohne an, initdb ab 18 legt mit an
  if as_pg "$oldbin/pg_controldata" "$old" | grep -q '^Data page checksum version: *0$'; then
    args+=(--no-data-checksums)
  fi

  # Ein abgebrochener früherer Versuch hinterlässt einen halben Cluster; der kommt weg
  rm -rf "$PGDATA"; rmdir "$(dirname "$PGDATA")" 2> /dev/null || true
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$(dirname "$PGDATA")"
  chmod 700 "$PGDATA"
  as_pg "$newbin/initdb" -D "$PGDATA" "${args[@]}" > "$work/initdb.log" \
    || { cat "$work/initdb.log" >&2; rm -rf "$PGDATA"; log "initdb fehlgeschlagen; der alte Bestand ist unverändert."; exit 1; }

  if ! (cd "$work" && as_pg "$newbin/pg_upgrade" --copy \
      --old-bindir="$oldbin" --new-bindir="$newbin" \
      --old-datadir="$old" --new-datadir="$PGDATA" \
      --username="$su" --socketdir="$work"); then
    # Die Protokolle legt pg_upgrade im neuen Cluster ab
    find "$PGDATA" -path '*pg_upgrade_output.d*' -name '*.log' -exec tail -n 30 {} + >&2 2> /dev/null || true
    rm -rf "$PGDATA"; rmdir "$(dirname "$PGDATA")" 2> /dev/null || true
    log "pg_upgrade fehlgeschlagen; der alte Bestand in $old ist unverändert."
    log "Zurück geht es mit dem bisherigen Image (etwa postgres:$old_v) und demselben Volume."
    exit 1
  fi

  # Zugriffsregeln und ALTER SYSTEM des alten Bestands übernehmen; postgresql.conf ist die neue
  local f
  for f in pg_hba.conf pg_ident.conf postgresql.auto.conf; do
    [ ! -f "$old/$f" ] || install -o postgres -g postgres -m 600 "$old/$f" "$PGDATA/$f"
  done
  rm -rf "$work"
  # Alte Anordnung: den alten Bestand aus der Wurzel des Volumes nach <alte Version>/docker räumen,
  # damit er neben dem neuen liegt statt um ihn herum. PG_VERSION zuerst: Bricht das Verschieben ab,
  # gilt die Wurzel nicht mehr als Datenbestand.
  if [ "$old" = "$base" ]; then
    local dest="$base/$old_v/docker" e
    mkdir -p "$dest"
    mv "$old/PG_VERSION" "$dest/"
    for e in "$old"/* "$old"/.[!.]*; do
      [ -e "$e" ] || continue
      case "${e##*/}" in "$PG_MAJOR" | "$old_v") continue ;; esac
      mv "$e" "$dest/"
    done
    chown postgres:postgres "$base/$old_v"
    chmod 700 "$dest"
    old="$dest"
  fi
  log "Upgrade auf PostgreSQL $PG_MAJOR fertig. Der alte Bestand liegt unverändert in $old;"
  log "läuft Haben einwandfrei, kann er weg: rm -rf $(dirname "$old") im Container"
  log "(siehe docs/installation.md, Abschnitt PostgreSQL-Update)."
}

if [ "$(id -u)" = 0 ] && [ ! -s "$PGDATA/PG_VERSION" ]; then
  if found="$(find_old)"; then
    upgrade ${found%% *} "${found#* }"
  fi
fi

exec docker-entrypoint.sh "$@"
