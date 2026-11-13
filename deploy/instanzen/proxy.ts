/**
 * Der gemeinsame Caddy unter <basis>/proxy: eine Datei je Domain in sites/, Caddyfile importiert alle. Jede Instanz
 * hat ein eigenes Netz zum Caddy (haben-proxy-<name>), in dem ihre App als haben-<name>:3000 erreichbar ist; der
 * Caddy hängt in allen, keine App im Netz einer anderen (#872).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose } from "./ausfuehren.ts";
import { abbrechen, type Kontext } from "./kontext.ts";

/** Das Netz zwischen Proxy und App einer Instanz; beginnt nie mit einer Ziffer und taugt so auch als YAML-Schlüssel */
export function netzFuer(name: string): string {
  return `haben-proxy-${name}`;
}

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

const COMPOSE = `# Gemeinsamer Caddy für alle Instanzen von Haben, angelegt von haben-instanzen.ts. Seine Netze stehen in
# compose.override.yml.
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
volumes:
  caddy:
`;

export function proxyDir(k: Kontext): string {
  return join(k.basis, "proxy");
}

/**
 * Die Netze des Caddy als compose.override.yml: Compose liest sie neben compose.yml mit und führt die Netzlisten
 * beider Dateien zusammen (compose-go, override/merge.go, mergeNetworks), eine ältere compose.yml behält so ihr
 * gemeinsames Netz haben-proxy. Die Liste steht in einer Datei und nicht nur am Container (docker network connect),
 * weil Compose den Container aus den Dateien neu aufbaut; die Netze legt der Caddy selbst an (kein external), ein
 * fehlendes hält seinen Start so nicht auf.
 */
function netzeDatei(netze: string[]): string {
  return [
    "# Von haben-instanzen.ts bei jedem `neu` aus den Instanzen neu geschrieben: je Instanz ein eigenes Netz zum Caddy.",
    "services:",
    "  caddy:",
    `    networks: [${netze.join(", ")}]`,
    "networks:",
    ...netze.flatMap((netz) => [`  ${netz}:`, `    name: ${netz}`]),
    "",
  ].join("\n");
}

/**
 * Instanzen hinter dem gemeinsamen Caddy (Datei in sites/), deren Override-Datei das eigene Netz nennt. Eine Instanz
 * von vor #872 hängt im gemeinsamen Netz haben-proxy aus compose.yml und fehlt hier, bis sie umgestellt ist.
 */
async function netzeDerInstanzen(k: Kontext): Promise<string[]> {
  const namen = (await readdir(join(proxyDir(k), "sites"))).filter((d) => d.endsWith(".caddy")).map((d) => d.slice(0, -".caddy".length));
  const netze: string[] = [];
  for (const name of namen.sort()) {
    const override = join(k.basis, name, "compose.override.yml");
    const zeilen = existsSync(override) ? (await readFile(override, "utf8")).split("\n") : [];
    if (zeilen.some((z) => z.trim() === `name: ${netzFuer(name)}`)) netze.push(netzFuer(name));
  }
  return netze;
}

/** Legt proxy/ an, wenn es fehlt, schreibt den Eintrag der Instanz und die Netze des Caddy */
export async function proxyEintragen(k: Kontext, name: string, domain: string): Promise<void> {
  const dir = proxyDir(k);
  await mkdir(join(dir, "sites"), { recursive: true });
  if (!existsSync(join(dir, "Caddyfile")))
    await writeFile(join(dir, "Caddyfile"), "# Eine Datei je Instanz, angelegt von haben-instanzen.ts\nimport sites/*.caddy\n");
  if (!existsSync(join(dir, "compose.yml"))) await writeFile(join(dir, "compose.yml"), COMPOSE);
  await writeFile(join(dir, "sites", `${name}.caddy`), caddyBlock(domain, name));
  await writeFile(join(dir, "compose.override.yml"), netzeDatei(await netzeDerInstanzen(k)));
}

/**
 * Startet den gemeinsamen Caddy. Läuft er schon, baut Compose den Container neu auf, weil sich seine Netze geändert
 * haben (kurze Unterbrechung für alle Instanzen); dabei liest er auch sites/ neu ein. Ein caddy reload reichte nicht:
 * Es hängt ihn in kein Netz.
 */
export async function proxyStarten(k: Kontext): Promise<void> {
  const dir = proxyDir(k);
  if ((await compose(k, dir, ["up", "-d"], true)).code !== 0)
    abbrechen(`Der gemeinsame Caddy ließ sich nicht starten; siehe: cd ${dir} && docker compose logs caddy`);
}
