#!/bin/sh
# Netze zweier Instanzen hinter dem gemeinsamen Caddy des Instanzen-Werkzeugs (#872): Der Caddy erreicht jede App
# unter ihrem Namen, keine App die andere, weder über den Namen noch über die Adresse. Geprüft nach dem Anlegen,
# nach einem Neustart des Docker-Daemons (wie beim Neustart des Hosts) und nach einem Neuaufbau des Caddy-Containers.
# Der Neustart kommt zuerst: Solange der Caddy nur per docker network connect im Netz von firma2 hängt (#1013), muss
# er es auch danach noch sein; der Neuaufbau zeigt dann, dass compose.override.yml beide Netze hält.
#   sh deploy/tests/instanzen-netze.sh <basis>      mit den Instanzen firma1 und firma2 unter <basis>
# Zuletzt löscht das Skript firma2 (down -v, rm -rf des Verzeichnisses) und prüft entfernen: firma2 hat es selbst per
# `neu` angelegt. Nie gegen eine echte Basis laufen lassen, nur gegen eine, die allein für diesen Test da ist.
# Ohne systemd nennt HABEN_DOCKER_NEUSTART den Befehl, der den Daemon neu startet.
set -eu
basis=$1

caddy() { (cd "$basis/proxy" && docker compose "$@"); }
app() { (cd "$basis/$1" && docker compose ps -q app); }
adresse() { docker inspect -f "{{(index .NetworkSettings.Networks \"haben-proxy-$1\").IPAddress}}" "$(app "$1")"; }
# Antwortet aus der App von $1 irgendetwas unter http://$2:3000?
erreicht() {
  docker exec "$(app "$1")" bun -e "fetch('http://$2:3000/login', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))"
}
# Steht die Domain in der laufenden Konfiguration? Nach einem Neuaufbau braucht die Admin-Schnittstelle einen Moment
caddy_kennt() {
  for _ in $(seq 10); do
    if caddy exec -T caddy wget -q -O - http://127.0.0.1:2019/config/ 2> /dev/null | grep -q "\"$1\""; then return 0; fi
    sleep 1
  done
  return 1
}
caddy_erreicht() { caddy exec -T caddy nc -z -w 5 "haben-$1" 3000; }

getrennt() {
  ip=$(adresse "$2")
  test -n "$ip"
  for ziel in "haben-$2" "$ip"; do
    if erreicht "$1" "$ziel"; then
      echo "Die App von $1 erreicht die von $2 unter $ziel" >&2
      exit 1
    fi
  done
}

pruefen() {
  for n in firma1 firma2; do
    caddy_erreicht "$n"
    # Gegenprobe: Unter dem eigenen Namen antwortet die App, die Prüfung unten scheitert also nicht am Befehl
    erreicht "$n" "haben-$n"
    # Der Caddy hat die Domain geladen (ein Zertifikat gibt es im Test nicht, über HTTPS antwortet sie deshalb nicht)
    caddy_kennt "$n.haben.test"
  done
  getrennt firma1 firma2
  getrennt firma2 firma1
  echo "Netze geprüft: $1"
}

pruefen "nach dem Anlegen"

sh -c "${HABEN_DOCKER_NEUSTART:-sudo systemctl restart docker}"
for _ in $(seq 60); do
  if caddy_erreicht firma1 && caddy_erreicht firma2; then break; fi
  sleep 2
done
pruefen "nach dem Neustart von Docker"

# Compose baut den Container aus compose.yml und compose.override.yml neu auf
caddy up -d --force-recreate
pruefen "nach dem Neuaufbau des Caddy"

# Löschen (#1068): firma2 ist weg, entfernen räumt nur den Proxy auf. Derselbe Caddy-Container antwortet für firma1
# durchgehend (ohne Zertifikat leitet er HTTP auf HTTPS um, 308; 000 hieße: keine Verbindung)
caddy_id=$(caddy ps -q caddy)
(cd "$basis/firma2" && docker compose down -v)
rm -rf "${basis:?}/firma2"
antworten=$(mktemp)
(while :; do curl -s -o /dev/null -m 2 -w '%{http_code}\n' -H 'Host: firma1.haben.test' http://127.0.0.1/; sleep 0.1; done) > "$antworten" &
schleife=$!
# Erst wenn die Schleife antwortet, zählt jede Antwort während entfernen; so hängt die Prüfung nicht an dessen Laufzeit
for _ in $(seq 50); do if [ -s "$antworten" ]; then break; fi; sleep 0.1; done
HABEN_INSTANZEN=$basis bun "$(dirname "$0")/../instanzen/haben-instanzen.ts" entfernen firma2 || { kill "$schleife"; exit 1; }
kill "$schleife"
test "$(grep -c . "$antworten")" -gt 0
if grep -qv '^308$' "$antworten"; then
  echo "Während entfernen antwortete der Caddy nicht immer mit 308:" >&2
  sort "$antworten" | uniq -c >&2
  exit 1
fi
rm -f "$antworten"
test "$(caddy ps -q caddy)" = "$caddy_id"
# Die Domain von firma2 steht nicht mehr in der laufenden Konfiguration, die von firma1 schon
if caddy exec -T caddy wget -q -O - http://127.0.0.1:2019/config/ | grep -q '"firma2.haben.test"'; then
  echo "Der Caddy kennt firma2.haben.test noch" >&2
  exit 1
fi
caddy_kennt firma1.haben.test
test ! -e "$basis/proxy/sites/firma2.caddy"
if docker network inspect haben-proxy-firma2 > /dev/null 2>&1; then
  echo "Das Netz haben-proxy-firma2 gibt es noch" >&2
  exit 1
fi
# Der Caddy hängt nicht mehr in haben-proxy-firma2, aber weiter in haben-proxy-firma1 (in der CI auch im Netz des
# Firmenportals, das portal vorher angelegt hat)
netze=$(docker inspect -f '{{range $n, $_ := .NetworkSettings.Networks}} {{$n}} {{end}}' "$caddy_id")
case "$netze" in *" haben-proxy-firma2 "*) echo "Der Caddy hängt noch in haben-proxy-firma2:$netze" >&2; exit 1 ;; esac
case "$netze" in *" haben-proxy-firma1 "*) ;; *) echo "Der Caddy hängt nicht mehr in haben-proxy-firma1:$netze" >&2; exit 1 ;; esac
caddy_erreicht firma1
echo "Netze geprüft: nach dem Entfernen von firma2"
