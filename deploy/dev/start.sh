#!/bin/sh
# Start des Entwicklungs-Containers (compose.yml im Hauptordner): Abhängigkeiten, Schlüssel, Migrationen, Dev-Server
set -eu
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
