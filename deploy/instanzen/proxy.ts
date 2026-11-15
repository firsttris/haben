/**
 * Der gemeinsame Caddy unter <basis>/proxy: eine Datei je Domain in sites/, Caddyfile importiert alle. Jede Instanz
 * hat ein eigenes Netz zum Caddy (haben-proxy-<name>), in dem ihre App als haben-<name>:3000 erreichbar ist; der
 * Caddy hängt in allen, keine App im Netz einer anderen (#872).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose, docker } from "./ausfuehren.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { dienste, lauf } from "./zustand.ts";

/** Das Netz zwischen Proxy und App einer Instanz; beginnt nie mit einer Ziffer und taugt so auch als YAML-Schlüssel */
export function netzFuer(name: string): string {
  return `haben-proxy-${name}`;
}

/**
 * Derselbe Block wie in compose.yml für eine einzelne Instanz und in deploy/Caddyfile, mit dem Alias als Ziel;
 * caddy-block.test.ts vergleicht die drei Stellen
 */
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
 * gemeinsames Netz haben-proxy. Den laufenden Container hängt proxyStarten mit docker network connect ein; die Liste
 * steht trotzdem in der Datei, weil ein Neuaufbau (von Hand, neues Image) den Container allein aus den Dateien
 * erzeugt. Die Netze legt Compose im Projekt des Caddy an (kein external), ein fehlendes hält seinen Start so nicht auf.
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
 * Der Wert einer Zeile `name: …`, wie Compose ihn liest: ohne Anführungszeichen und ohne Kommentar am Zeilenende.
 * Wer eine Instanz von Hand umstellt, schreibt die Zeile nicht immer wie das Werkzeug; fehlte ihr Netz deshalb beim
 * Caddy, wäre sie ohne Meldung nicht mehr erreichbar.
 */
function netzname(zeile: string): string | undefined {
  return /^\s*name:\s*(["']?)([^"'#\s]+)\1\s*(#.*)?$/.exec(zeile)?.[2];
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
    if (zeilen.some((z) => netzname(z) === netzFuer(name))) netze.push(netzFuer(name));
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

/** Bricht mit der Meldung ab und nennt, wo der Caddy seine Gründe schreibt */
function caddyFehler(k: Kontext, meldung: string): never {
  abbrechen(`${meldung}; siehe: cd ${proxyDir(k)} && docker compose logs caddy`);
}

/**
 * Startet den gemeinsamen Caddy oder hängt den laufenden in das Netz der neuen Instanz, ohne ihn neu aufzubauen (#1013).
 * Ein schlichtes `up -d` baute einen laufenden Container neu auf, sobald sich seine Netze in compose.override.yml
 * ändern (das Netz zählt zum Config-Hash des Dienstes), und jede Instanz dahinter wäre kurz nicht erreichbar.
 * Stattdessen: `up -d --no-recreate` legt das Netz an, ohne den Container anzufassen, `docker network connect` hängt
 * ihn hinein, `caddy reload` liest sites/ ohne Unterbrechung neu. Läuft der Caddy nicht, unterbricht ein Neuaufbau
 * nichts; dann baut ihn `up -d` aus den Dateien auf und liest dabei auch sites/ ein.
 */
export async function proxyStarten(k: Kontext, name: string): Promise<void> {
  const dir = proxyDir(k);
  if (lauf(await dienste(k, dir), "caddy") !== "laeuft") {
    if ((await compose(k, dir, ["up", "-d"], true)).code !== 0) caddyFehler(k, "Der gemeinsame Caddy ließ sich nicht starten");
    return;
  }
  const netz = netzFuer(name);
  if ((await compose(k, dir, ["up", "-d", "--no-recreate"], true)).code !== 0) caddyFehler(k, `Das Netz ${netz} ließ sich nicht anlegen`);
  const id = (await compose(k, dir, ["ps", "-q", "caddy"])).stdout.trim();
  if (id === "" || (await docker(k, ["network", "connect", netz, id])).code !== 0)
    caddyFehler(k, `Der gemeinsame Caddy ließ sich nicht in das Netz ${netz} hängen`);
  if ((await compose(k, dir, ["exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"])).code !== 0)
    caddyFehler(k, "Der gemeinsame Caddy hat sites/ nicht neu eingelesen und behält die bisherige Konfiguration");
}
