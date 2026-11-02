#!/bin/sh
# Start des Entwicklungs-Containers (compose.yml im Hauptordner): Abhängigkeiten, Schlüssel, Migrationen, Dev-Server
set -eu

# Als root nur die Volumes dem Benutzer node geben und dann als node weiter. Ein Volume übernimmt den Besitzer
# nur beim ersten Anlegen; nach einem Neubau mit anderer HABEN_DEV_UID gehört es sonst noch der alten ID und
# pnpm install scheitert mit EACCES. Den eingehängten Projektordner fasst das nicht an.
if [ "$(id -u)" = 0 ]; then
  for dir in /app/node_modules /app/apps/web/node_modules /app/packages/core/node_modules \
    /app/packages/einvoice/node_modules /app/packages/elster/node_modules /app/packages/import/node_modules \
    /home/node/.cache /var/lib/haben; do
    [ "$(stat -c %u:%g "$dir")" = "$(id -u node):$(id -g node)" ] || chown -R node:node "$dir"
  done
  HOME=/home/node exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

cd /app

# Schnell, solange sich pnpm-lock.yaml nicht geändert hat
pnpm install --frozen-lockfile

# Eigene Schlüssel für diese Entwicklungsumgebung, beim ersten Start zufällig erzeugt und im Volume
# neben den Belegen abgelegt. Feste Werte stehen bewusst nirgends im Repository.
keys=/var/lib/haben/schluessel.env
if [ ! -f "$keys" ]; then
  node -e '
    const key = () => require("node:crypto").randomBytes(32).toString("base64");
    console.log(`BETTER_AUTH_SECRET=${key()}\nHABEN_ENCRYPTION_KEY=${key()}`);
  ' > "$keys.neu"
  mv "$keys.neu" "$keys"
fi
set -a
. "$keys"
set +a

pnpm db:migrate
# --host: im Container auf allen Schnittstellen lauschen, sonst erreicht ihn die Portfreigabe nicht
exec pnpm --filter @haben/web exec vite dev --host 0.0.0.0 --port "$HABEN_DEV_PORT"
