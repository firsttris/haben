# Haben – App-Container. ERiC wird nicht mitgeliefert (Lizenz); Haben lädt es auf Wunsch nach /var/lib/haben/eric
# (Volume) oder es wird nach /opt/eric gemountet.
FROM docker.io/oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY bun.lock bunfig.toml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/elster-helfer/package.json apps/elster-helfer/
COPY apps/portal/package.json apps/portal/
# Alle Workspace-Pakete, sonst fehlen deren Abhängigkeiten (z. B. pdf-lib in einvoice, zod in import)
COPY packages/core/package.json packages/core/
COPY packages/einvoice/package.json packages/einvoice/
COPY packages/elster/package.json packages/elster/
COPY packages/gobd-kern/package.json packages/gobd-kern/
COPY packages/import/package.json packages/import/
RUN bun install --frozen-lockfile
COPY . .
# Danach nur noch die Laufzeitabhängigkeiten; neu installieren statt entfernen, die Pakete liegen im Cache. Ohne
# Peer-Abhängigkeiten: Über sie kämen Build-Werkzeuge ins Image (vite, vitest, drizzle-kit, tsx, esbuild mit eigener
# Go-Laufzeit), die zur Laufzeit nicht laufen. Was die App als Peer braucht (react, zod, postgres …), steht in
# apps/web/package.json als direkte Abhängigkeit; der CI-Job container lädt die externen Module des Bundles.
# Der Befehl haben (Betriebsstatus) als eine Datei; Pakete aus node_modules bleiben außen vor und kommen zur Laufzeit
# aus apps/web/node_modules, so bleibt etwa die native Bibliothek von Typst nur einmal im Image
RUN bun run build \
 && bun build apps/web/src/server/modules/betrieb/cli.ts --target bun --packages external --outfile apps/web/.output/haben-cli.js \
 && rm -rf node_modules apps/web/node_modules packages/*/node_modules \
 && bun install --frozen-lockfile --production --omit=peer

# Laufzeit auf Wolfi statt Debian: glibc wie bisher (ERiC ist eine glibc-Bibliothek, Alpine mit musl ginge nicht),
# aber aktuelle Upstream-Versionen, vor allem von poppler, das jedes hochgeladene PDF liest. Wolfi ist rollend; der
# Digest hält den Build reproduzierbar, Renovate hebt ihn an.
FROM cgr.dev/chainguard/wolfi-base:latest@sha256:b7787f1d3f29dcfb48730372d3515391ac3b218723201a765c94949922676099
# Dasselbe Bun wie in der Build-Stufe (glibc-Build); Renovate verfolgt oven/bun weiter an beiden Stellen
COPY --from=docker.io/oven/bun:1.4.4-slim /usr/local/bin/bun /usr/local/bin/bun
# poppler-utils: pdftotext und pdftoppm für hochgeladene PDFs (Textebene, Seitenbilder für einen eigenen KI-Dienst),
# als eigener Prozess. font-liberation: ohne Schriften rendert pdftoppm nicht eingebettete Standardschriften wie
# Helvetica gar nicht. libgcc: libgcc_s braucht ERiC neben glibc (steckt schon in wolfi-base, hier ausdrücklich).
# Benutzer bun mit UID 1000 wie im Image von oven/bun, damit bestehende Volumes lesbar bleiben. Die Pakete kommen aus
# dem freien Wolfi-Repository; wolfi-base nennt in /etc/apk/repositories das von Chainguard, das eine Anmeldung verlangt.
RUN echo https://packages.wolfi.dev/os > /etc/apk/repositories \
 && apk add --no-cache poppler-utils font-liberation tzdata libgcc \
 && addgroup -g 1000 bun \
 && adduser -D -u 1000 -G bun -h /home/bun -s /bin/sh bun
ENV NODE_ENV=production \
    PORT=3000 \
    ERIC_WORKER_PATH=/app/packages/elster/src/worker.ts \
    HABEN_EINVOICE_DIR=/app/packages/einvoice \
    DOCUMENTS_DIR=/var/lib/haben/belege \
    ERIC_LOG_DIR=/var/lib/haben/eric-log \
    ERIC_DIR=/var/lib/haben/eric \
    XDG_CACHE_HOME=/tmp/.cache
# XDG_CACHE_HOME: Fontconfig (pdftoppm) braucht einen beschreibbaren Cache, auch bei schreibgeschütztem Dateisystem
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
RUN mkdir -p /var/lib/haben/eric-log /var/lib/haben/eric /var/lib/haben/belege && chown -R bun:bun /var/lib/haben
# Commit des Builds (#887) für haben status und als OCI-Label, etwa --build-arg HABEN_COMMIT="$(git rev-parse HEAD)".
# Ohne Angabe leer. Erst hier, damit ein anderer Commit nur diese Schichten neu baut
ARG HABEN_COMMIT=""
LABEL org.opencontainers.image.revision="$HABEN_COMMIT"
ENV HABEN_COMMIT="$HABEN_COMMIT"
USER bun
EXPOSE 3000
# Ohne curl im Image: Bun hat fetch eingebaut. Die Startphase deckt die Migrationen ab.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["haben-entrypoint"]
