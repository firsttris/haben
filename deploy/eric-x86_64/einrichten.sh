#!/bin/sh
# ERiC auf einem Server ohne Linux x86_64 (arm64: Raspberry Pi, Jetson, Ampere): legt die x86_64-Laufzeit an, mit
# der Haben den ERiC-Worker unter QEMU startet. Die App selbst läuft weiter nativ; emuliert wird nur der kurzlebige
# Worker je ELSTER-Aufruf. Auf dem Host als root ausführen, danach in der App einbinden (docs/installation.md,
# „ELSTER auf arm64“):
#
#   sudo sh deploy/eric-x86_64/einrichten.sh 0.6.3            # dieselbe Version wie das App-Image
#   sudo sh deploy/eric-x86_64/einrichten.sh 0.6.3 /opt/haben-x86_64
#
# Nach jedem Update der App mit der neuen Version wiederholen: worker.sh startet nur, wenn beide Versionen gleich sind.
#
# Was im Zielverzeichnis entsteht:
#   root/         Dateisystem des amd64-Images von Haben: Bun, worker.ts und node_modules mit koffi für x86_64
#                 sowie die Bibliotheken, die ERiC braucht
#   qemu-x86_64   statisches QEMU (User-Mode, ab Version 9; mit 8.2 stürzt Bun beim Start ab)
#   worker.sh     der Befehl für ERIC_WORKER_COMMAND
#
# QEMU: aus $QEMU, sonst qemu-x86_64-static oder qemu-x86_64 aus dem PATH. Es muss statisch gebaut sein, weil es im
# Container ohne die Bibliotheken des Hosts läuft (Debian ab 13: Paket qemu-user; Ubuntu 24.04 hat nur 8.2).
set -eu

VERSION=${1:?"Aufruf: $0 <Haben-Version, z. B. 0.6.3> [Zielverzeichnis, Standard /opt/haben-x86_64]"}
ZIEL=${2:-/opt/haben-x86_64}
IMAGE=${HABEN_IMAGE:-tristanteu/haben}

fehler() {
  echo "Fehler: $*" >&2
  exit 1
}

ENGINE=$(command -v docker || command -v podman || true)
[ -n "$ENGINE" ] || fehler "weder docker noch podman gefunden"

QEMU=${QEMU:-$(command -v qemu-x86_64-static || command -v qemu-x86_64 || true)}
[ -n "$QEMU" ] && [ -x "$QEMU" ] || fehler "kein qemu-x86_64 gefunden; Pfad mit QEMU=… angeben"
qemu_major=$("$QEMU" --version | sed -n 's/.*version \([0-9][0-9]*\)\..*/\1/p' | head -n 1)
[ "${qemu_major:-0}" -ge 9 ] || fehler "$QEMU ist Version ${qemu_major:-?}; Bun braucht QEMU ab Version 9"
# ldd meldet „statically linked“ (static-pie) oder „not a dynamic executable“; alles andere hängt an Bibliotheken
case $(ldd "$QEMU" 2>&1) in
  *"statically linked"* | *"not a dynamic executable"*) ;;
  *) fehler "$QEMU ist nicht statisch gebaut und liefe im Container nicht" ;;
esac

mkdir -p "$ZIEL"
neu="$ZIEL/root.neu"
rm -rf "$neu"
mkdir "$neu"

# Ein Pull mit --platform setzt den lokalen Tag (klassischer Image-Store von Docker, Podman) auf das amd64-Image. Die
# App auf diesem Rechner nutzt denselben Tag; ohne Gegenmaßnahme startete sie danach das amd64-Image. Deshalb zeigt der
# Tag am Ende wieder auf das Image von vorher, und gab es keins, wird der Tag entfernt.
vorher=$("$ENGINE" image inspect --format '{{.Id}}' "$IMAGE:$VERSION" 2>/dev/null || true)
container=
aufraeumen() {
  if [ -n "$container" ]; then
    "$ENGINE" rm "$container" >/dev/null 2>&1 || true
  fi
  if [ -n "$vorher" ]; then
    "$ENGINE" tag "$vorher" "$IMAGE:$VERSION" >/dev/null 2>&1 || true
  else
    "$ENGINE" rmi "$IMAGE:$VERSION" >/dev/null 2>&1 || true
  fi
}
trap aufraeumen EXIT

echo "Lade $IMAGE:$VERSION für linux/amd64 …"
"$ENGINE" pull --platform linux/amd64 "$IMAGE:$VERSION" >/dev/null
container=$("$ENGINE" create --platform linux/amd64 "$IMAGE:$VERSION")
"$ENGINE" export "$container" | tar -x -C "$neu"
[ -x "$neu/usr/local/bin/bun" ] && [ -f "$neu/app/packages/elster/src/worker.ts" ] || fehler "unerwarteter Aufbau des Images"
# QEMU (-L) sucht jede Datei zuerst unter root/. Ohne diese Dateien gelten die des Containers (DNS, Hostname).
rm -f "$neu/etc/resolv.conf" "$neu/etc/hosts" "$neu/etc/hostname"

cp "$QEMU" "$ZIEL/qemu-x86_64.neu"
chmod 755 "$ZIEL/qemu-x86_64.neu"
mv "$ZIEL/qemu-x86_64.neu" "$ZIEL/qemu-x86_64"

cat >"$ZIEL/worker.sh.neu" <<'SKRIPT'
#!/bin/sh
# ERIC_WORKER_COMMAND für Haben auf arm64, angelegt von deploy/eric-x86_64/einrichten.sh: startet den ERiC-Worker als
# x86_64-Prozess unter QEMU. $1 ist worker.ts der App; ausgeführt wird dieselbe Datei aus der x86_64-Laufzeit, deren
# node_modules koffi für x86_64 haben (die App hat es nur für ihre eigene Architektur).
set -eu
dir=$(dirname "$0")
app=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' /app/package.json 2>/dev/null || true)
x86=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$dir/root/app/package.json")
if [ -n "$app" ] && [ "$app" != "$x86" ]; then
  echo "x86_64-Laufzeit für ERiC ist Version $x86, die App $app: einrichten.sh mit $app wiederholen" >&2
  exit 1
fi
# Unbegrenzter Stack: Linux legt den Speicher dann von unten an, unter der 47-Bit-Grenze, die JavaScriptCore auf
# x86_64 voraussetzt. Sonst vergibt der Host unter QEMU höhere Adressen, und Bun bricht mit „MemoryExhaustion“ ab.
ulimit -s unlimited
exec "$dir/qemu-x86_64" -L "$dir/root" "$dir/root/usr/local/bin/bun" "$dir/root$1"
SKRIPT
chmod 755 "$ZIEL/worker.sh.neu"
mv "$ZIEL/worker.sh.neu" "$ZIEL/worker.sh"

if [ -d "$ZIEL/root" ]; then
  mv "$ZIEL/root" "$ZIEL/root.alt"
fi
mv "$neu" "$ZIEL/root"
rm -rf "$ZIEL/root.alt"

echo "Fertig: $ZIEL (Haben $VERSION für x86_64, $("$QEMU" --version | head -n 1))."
echo "In der App einbinden: Volume $ZIEL:$ZIEL:ro und ERIC_WORKER_COMMAND=$ZIEL/worker.sh, siehe docs/installation.md."
