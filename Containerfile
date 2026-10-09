# Haben – App-Container. ERiC wird nicht mitgeliefert (Lizenz); Haben lädt es auf Wunsch nach /var/lib/haben/eric
# (Volume) oder es wird nach /opt/eric gemountet.
FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
# Alle Workspace-Pakete, sonst fehlen deren Abhängigkeiten (z. B. pdf-lib in einvoice, zod in import)
COPY packages/core/package.json packages/core/
COPY packages/einvoice/package.json packages/einvoice/
COPY packages/elster/package.json packages/elster/
COPY packages/import/package.json packages/import/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @haben/web build \
 && CI=true pnpm install --frozen-lockfile --prod --offline

FROM docker.io/library/node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    ERIC_WORKER_PATH=/app/packages/elster/src/worker.ts \
    HABEN_EINVOICE_DIR=/app/packages/einvoice \
    DOCUMENTS_DIR=/var/lib/haben/belege \
    ERIC_LOG_DIR=/var/lib/haben/eric-log \
    ERIC_DIR=/var/lib/haben/eric
WORKDIR /app
# Der ERiC-Worker läuft aus den Quellen von packages/elster (Type Stripping, nicht unter node_modules).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.output ./apps/web/.output
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build /app/apps/web/src/server/db/migrate.ts ./apps/web/src/server/db/migrate.ts
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/package.json ./package.json
COPY deploy/entrypoint.sh /usr/local/bin/haben-entrypoint
RUN mkdir -p /var/lib/haben/eric-log /var/lib/haben/eric /var/lib/haben/belege && chown -R node:node /var/lib/haben
USER node
EXPOSE 3000
# Ohne curl im Image: Node hat fetch eingebaut. Die Startphase deckt die Migrationen ab.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["haben-entrypoint"]
