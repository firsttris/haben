#!/bin/sh
# Start des Entwicklungs-Containers (compose.yml im Hauptordner): Abhängigkeiten, Schlüssel, Migrationen, Dev-Server
set -eu

modules="/app/node_modules /app/apps/web/node_modules /app/apps/elster-helfer/node_modules /app/apps/portal/node_modules /app/packages/core/node_modules
  /app/packages/einvoice/node_modules /app/packages/elster/node_modules /app/packages/gobd-kern/node_modules
  /app/packages/import/node_modules"

# Als root nur die Volumes dem Benutzer bun geben und dann als bun weiter. Ein Volume übernimmt den Besitzer
# nur beim ersten Anlegen; nach einem Neubau mit anderer HABEN_DEV_UID gehört es sonst noch der alten ID und
# bun install scheitert mit EACCES. Den eingehängten Projektordner fasst das nicht an.
if [ "$(id -u)" = 0 ]; then
  for dir in $modules /home/bun/.cache /var/lib/haben; do
    [ "$(stat -c %u:%g "$dir")" = "$(id -u bun):$(id -g bun)" ] || chown -R bun:bun "$dir"
  done
  HOME=/home/bun exec setpriv --reuid=bun --regid=bun --init-groups "$0" "$@"
fi

cd /app

# Volumes aus der Zeit mit pnpm (Haben bis 0.2) leeren; bun install legt sie neu an
if [ -d /app/node_modules/.pnpm ]; then
  for dir in $modules; do find "$dir" -mindepth 1 -delete; done
fi

# Schnell, solange sich bun.lock nicht geändert hat
bun install --frozen-lockfile

# Eigene Schlüssel für diese Entwicklungsumgebung, beim ersten Start zufällig erzeugt und im Volume
# neben den Belegen abgelegt. Feste Werte stehen bewusst nirgends im Repository.
keys=/var/lib/haben/schluessel.env
if [ ! -f "$keys" ]; then
  bun -e '
    const key = () => require("node:crypto").randomBytes(32).toString("base64");
    console.log(`BETTER_AUTH_SECRET=${key()}\nHABEN_ENCRYPTION_KEY=${key()}`);
  ' > "$keys.neu"
  mv "$keys.neu" "$keys"
fi
set -a
. "$keys"
set +a

bun run db:migrate
# Auch der Dev-Server erhält bei getrennten Rollen nur die App-Anmeldung.
# Bun darf die private Adresse nicht aus apps/web/.env wieder laden; andere .env-Werte bleiben erhalten.
export MIGRATION_DATABASE_URL=
# --host: im Container auf allen Schnittstellen lauschen, sonst erreicht ihn die Portfreigabe nicht
cd apps/web
exec bun --bun vite dev --host 0.0.0.0 --port "$HABEN_DEV_PORT"
