#!/bin/sh
set -eu
cd /app/apps/web
node --experimental-strip-types --disable-warning=ExperimentalWarning src/server/db/migrate.ts
exec node .output/server/index.mjs
