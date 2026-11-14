#!/bin/sh
# Netze zweier Instanzen hinter dem gemeinsamen Caddy des Instanzen-Werkzeugs (#872): Der Caddy erreicht jede App
# unter ihrem Namen, keine App die andere, weder über den Namen noch über die Adresse. Geprüft nach dem Anlegen,
# nach einem Neuaufbau des Caddy-Containers und nach einem Neustart des Docker-Daemons (wie beim Neustart des Hosts).
#   sh deploy/tests/instanzen-netze.sh <basis>      mit den Instanzen firma1 und firma2 unter <basis>
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

# Compose baut den Container aus compose.yml und compose.override.yml neu auf
caddy up -d --force-recreate
pruefen "nach dem Neuaufbau des Caddy"

sh -c "${HABEN_DOCKER_NEUSTART:-sudo systemctl restart docker}"
for _ in $(seq 60); do
  if caddy_erreicht firma1 && caddy_erreicht firma2; then break; fi
  sleep 2
done
pruefen "nach dem Neustart von Docker"
