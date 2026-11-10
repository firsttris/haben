/**
 * Der gemeinsame Caddy unter <basis>/proxy: eine Datei je Domain in sites/, Caddyfile importiert alle. Die Apps
 * hängen im Netz haben-proxy und sind dort als haben-<name>:3000 erreichbar.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose } from "./ausfuehren.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { dienste, lauf } from "./zustand.ts";

export const NETZ = "haben-proxy";

/** Derselbe Block wie in compose.yml für eine einzelne Instanz, mit dem Alias als Ziel */
export function caddyBlock(domain: string, name: string): string {
  return `${domain} {
\tencode zstd gzip
\theader {
\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains"
\t\tX-Content-Type-Options nosniff
\t\tReferrer-Policy same-origin
\t\tX-Frame-Options SAMEORIGIN
\t}
\t# Uploads: Archivdateien bis 100 MB, Belege bis 20 MB je Datei; mehrere Dateien gehen in einer Anfrage
\trequest_body {
\t\tmax_size 250MB
\t}
\treverse_proxy haben-${name}:3000
}
`;
}

const COMPOSE = `# Gemeinsamer Caddy für alle Instanzen von Haben, angelegt von haben-instanzen.ts
name: haben-proxy
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - caddy:/data
    networks: [proxy]
networks:
  proxy:
    name: ${NETZ}
volumes:
  caddy:
`;

export function proxyDir(k: Kontext): string {
  return join(k.basis, "proxy");
}

/** Legt proxy/ an, wenn es fehlt, und schreibt den Eintrag der Instanz */
export async function proxyEintragen(k: Kontext, name: string, domain: string): Promise<void> {
  const dir = proxyDir(k);
  await mkdir(join(dir, "sites"), { recursive: true });
  if (!existsSync(join(dir, "Caddyfile")))
    await writeFile(join(dir, "Caddyfile"), "# Eine Datei je Instanz, angelegt von haben-instanzen.ts\nimport sites/*.caddy\n");
  if (!existsSync(join(dir, "compose.yml"))) await writeFile(join(dir, "compose.yml"), COMPOSE);
  await writeFile(join(dir, "sites", `${name}.caddy`), caddyBlock(domain, name));
}

/** Startet den gemeinsamen Caddy (legt dabei das Netz an); läuft er schon, liest er seine Konfiguration neu ein */
export async function proxyStarten(k: Kontext): Promise<void> {
  const dir = proxyDir(k);
  const r =
    lauf(await dienste(k, dir), "caddy") === "laeuft"
      ? await compose(k, dir, ["exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], true)
      : await compose(k, dir, ["up", "-d"], true);
  if (r.code !== 0) abbrechen(`Der gemeinsame Caddy ließ sich nicht starten oder neu laden; siehe: cd ${dir} && docker compose logs caddy`);
}
