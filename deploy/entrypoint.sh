#!/bin/sh
set -eu
cd /app/apps/web
bun src/server/db/migrate.ts
# ERIC_AUTO_INSTALL=ja: ERiC beim Start von download.elster.de laden, falls es fehlt (Zustimmung zu den Nutzungsbedingungen)
if [ -z "${ERIC_HOME:-}" ] && [ "${ERIC_AUTO_INSTALL:-}" = "ja" ]; then
  bun /app/packages/elster/src/install-cli.ts --lizenz-akzeptiert --nur-wenn-fehlt \
    || echo "ERiC konnte nicht geladen werden; Prüfen und Senden laufen simuliert." >&2
fi
exec bun .output/server/index.mjs
