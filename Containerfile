# Haben – App-Container. ERiC wird nicht mitgeliefert (Lizenz), sondern nach /opt/eric gemountet.
FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/elster/package.json packages/elster/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @haben/web build \
 && pnpm install --frozen-lockfile --prod --offline

FROM docker.io/library/node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    ERIC_WORKER_PATH=/app/packages/elster/src/worker.ts \
    ERIC_LOG_DIR=/var/lib/haben/eric-log
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
RUN mkdir -p /var/lib/haben/eric-log && chown -R node:node /var/lib/haben
USER node
EXPOSE 3000
ENTRYPOINT ["haben-entrypoint"]
