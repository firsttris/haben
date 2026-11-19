#!/bin/sh
# Erzeugt die Zertifikatsdateien für die Tests des Ablaufdatums (#1366) neu, mit erfundenen Daten.
# Braucht OpenSSL ab 3.4 (-not_before, -not_after) mit Legacy-Provider (RC2), etwa im Dev-Container:
#   docker compose run --rm -u bun app sh apps/web/src/test-fixtures/elster-zertifikat/erzeugen.sh
#
# Aufbau wie eine Datei aus Mein ELSTER: das Zertifikat zum Schlüssel samt dem der Zertifizierungsstelle. Die Stelle
# läuft früher ab und darf nicht zählen. notAfter des Zertifikats ist der 31.12.2029, 23:30 UTC, in Deutschland schon
# der 1.1.2030. PIN und erwartete Tage stehen in ../elster-zertifikat.ts.
set -eu
cd "$(dirname "$0")"
PIN='Erika 1366!'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/ca.key" -out ca.pem \
  -subj "/O=Erfundene Zertifizierungsstelle/CN=Test-CA Haben" -not_before 20261101000000Z -not_after 20280630120000Z
openssl req -newkey rsa:2048 -nodes -keyout "$tmp/schluessel.pem" -out "$tmp/antrag.csr" -subj "/O=Testzertifikat Haben/CN=1000000001"
openssl x509 -req -in "$tmp/antrag.csr" -CA ca.pem -CAkey "$tmp/ca.key" -set_serial 2 \
  -not_before 20261101000000Z -not_after 20291231233000Z -out zertifikat.pem

pfx() {
  openssl pkcs12 -export -inkey "$tmp/schluessel.pem" -in zertifikat.pem -certfile ca.pem -passout "pass:$PIN" "$@"
}
# Wie die Datei aus Mein ELSTER vom November 2024: Zertifikate mit RC2-40, Schlüssel mit 3DES, MAC mit SHA-1
pfx -legacy -iter 10000 -out rc2-40.pfx
pfx -legacy -certpbe PBE-SHA1-RC2-128 -iter 10000 -out rc2-128.pfx
pfx -legacy -certpbe PBE-SHA1-3DES -iter 10000 -out 3des.pfx
# Vorgabe von OpenSSL 3: PBES2 mit PBKDF2 (HMAC-SHA-256) und AES-256-CBC
pfx -iter 10000 -out aes.pfx
# Zertifikate ohne Verschlüsselung, nur der Schlüssel verschlüsselt
pfx -certpbe NONE -iter 10000 -out ohne-verschluesselung.pfx
# Mehr Iterationen, als Haben rechnet (MAX_ITERATIONS in apps/web/src/server/modules/elster/pkcs12.ts)
pfx -legacy -iter 1000001 -out zu-viele-iterationen.pfx
