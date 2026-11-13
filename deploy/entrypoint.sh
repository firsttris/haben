#!/bin/sh
set -eu
cd /app/apps/web
bun src/server/db/migrate.ts
# Die Eigentümerverbindung gehört nur zum Migrationsschritt, nicht in den Server oder seine Kindprozesse.
# Leer überschreibt auch Buns .env-Nachladen; unset würde die private Adresse erneut einlesen.
export MIGRATION_DATABASE_URL=
# ERIC_AUTO_INSTALL=ja: ERiC beim Start von download.elster.de laden, falls es fehlt (Zustimmung zu den Nutzungsbedingungen)
if [ -z "${ERIC_HOME:-}" ] && [ "${ERIC_AUTO_INSTALL:-}" = "ja" ]; then
  bun /app/packages/elster/src/install-cli.ts --lizenz-akzeptiert --nur-wenn-fehlt \
    || echo "ERiC konnte nicht geladen werden; Prüfen und Senden laufen simuliert." >&2
fi
exec bun .output/server/index.mjs
