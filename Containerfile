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
# Danach nur noch die Laufzeitabhängigkeiten; neu installieren statt entfernen, die Pakete liegen im Cache.
# Der Befehl haben (Betriebsstatus) als eine Datei; Pakete aus node_modules bleiben außen vor und kommen zur Laufzeit
# aus apps/web/node_modules, so bleibt etwa die native Bibliothek von Typst nur einmal im Image
RUN bun run build \
 && bun build apps/web/src/server/modules/betrieb/cli.ts --target bun --packages external --outfile apps/web/.output/haben-cli.js \
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
# Betreiberbefehle für SSO und Bestandsübernahme nutzen dieselben geprüften Geschäftsregeln wie die App.
COPY --from=build /app/apps/web/src ./apps/web/src
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/package.json ./package.json
COPY deploy/entrypoint.sh /usr/local/bin/haben-entrypoint
# haben status [--json]: Version, ERiC und letzte Sicherung, etwa für deploy/instanzen
COPY deploy/haben.sh /usr/local/bin/haben
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
