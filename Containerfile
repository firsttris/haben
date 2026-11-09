# Haben – App-Container. ERiC wird nicht mitgeliefert (Lizenz); Haben lädt es auf Wunsch nach /var/lib/haben/eric
# (Volume) oder es wird nach /opt/eric gemountet.
FROM docker.io/oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY bun.lock bunfig.toml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/elster-helfer/package.json apps/elster-helfer/
# Alle Workspace-Pakete, sonst fehlen deren Abhängigkeiten (z. B. pdf-lib in einvoice, zod in import)
COPY packages/core/package.json packages/core/
COPY packages/einvoice/package.json packages/einvoice/
COPY packages/elster/package.json packages/elster/
COPY packages/import/package.json packages/import/
RUN bun install --frozen-lockfile
COPY . .
# Danach nur noch die Laufzeitabhängigkeiten; neu installieren statt entfernen, die Pakete liegen im Cache
RUN bun run build \
 && rm -rf node_modules apps/web/node_modules packages/*/node_modules \
 && bun install --frozen-lockfile --production

FROM docker.io/oven/bun:1.4.4-slim
ENV NODE_ENV=production \
    PORT=3000 \
    ERIC_WORKER_PATH=/app/packages/elster/src/worker.ts \
    HABEN_EINVOICE_DIR=/app/packages/einvoice \
    DOCUMENTS_DIR=/var/lib/haben/belege \
    ERIC_LOG_DIR=/var/lib/haben/eric-log \
    ERIC_DIR=/var/lib/haben/eric
WORKDIR /app
# Der ERiC-Worker läuft aus den Quellen von packages/elster (Bun führt TypeScript direkt aus, nicht unter node_modules).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.output ./apps/web/.output
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build /app/apps/web/src/server/db/migrate.ts ./apps/web/src/server/db/migrate.ts
# Betreiberfunktion für den SSO-Modus: bestehende Konten ausdrücklich einer Identität zuordnen (docs/installation.md)
COPY --from=build /app/apps/web/src/server/db/sso-uebernahme.ts /app/apps/web/src/server/db/app-lock.ts ./apps/web/src/server/db/
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/package.json ./package.json
COPY deploy/entrypoint.sh /usr/local/bin/haben-entrypoint
# pdftoppm: PDFs als Seitenbilder für einen selbst betriebenen KI-Dienst (Belegauslesung), als eigener Prozess
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/lib/haben/eric-log /var/lib/haben/eric /var/lib/haben/belege && chown -R bun:bun /var/lib/haben
USER bun
EXPOSE 3000
# Ohne curl im Image: Bun hat fetch eingebaut. Die Startphase deckt die Migrationen ab.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["haben-entrypoint"]
