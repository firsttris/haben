#!/bin/sh
# Befehle für Betreiber im Image, etwa: docker compose exec app haben status --json
# (Quelle: apps/web/src/server/modules/betrieb/cli.ts, gebündelt im Containerfile)
exec bun /app/apps/web/.output/haben-cli.js "$@"
