/**
 * Prüfungen vor `neu`: erst die Angaben, dann die Trennung von allem, was es schon gibt. Jede bricht beim ersten
 * Fund ab, bevor etwas angelegt ist.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { docker } from "./ausfuehren.ts";
import { instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { proxyDir } from "./proxy.ts";

export interface NeuAngaben {
  name: string;
  domain: string;
  herstellerId?: string;
  ericHome?: string;
  eigenerProxy: boolean;
  starten: boolean;
  sso?: { issuer: string; clientId: string; clientSecret: string; anzeigename: string };
}

export function pruefeName(name: string): void {
  if (!/^[a-z0-9]([a-z0-9-]{0,29}[a-z0-9])?$/.test(name))
    abbrechen(`Name nur aus a–z, 0–9 und -, am Anfang und Ende Buchstabe oder Ziffer, höchstens 31 Zeichen: ${name}`);
  // Container heißen <projekt>-<dienst>-<nummer> und sind im Netz des Proxys unter diesem Namen erreichbar; der Alias
  // haben-<name> darf keinem davon gleichen (etwa firma1-app-1 und die App von firma1, app-1 und die App des
  // Standardprojekts haben)
  if (/(^|-)(app|db|backup|restore|caddy)-[0-9]+$/.test(name)) abbrechen(`Der Name darf nicht auf app-1, db-1 o. Ä. enden: ${name}`);
  if (name === "proxy") abbrechen("Der Name proxy ist für den gemeinsamen Caddy reserviert.");
  // haben-app ist der Alias einer einzelnen Instanz nach deploy/compose.override.example.yml
  if (name === "app") abbrechen("Der Name app ist reserviert (Alias haben-app einer einzelnen Instanz).");
}

export function pruefeDomain(domain: string): void {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain))
    abbrechen(`Domain ohne https:// und ohne Pfad, klein geschrieben, z. B. firma1.example.de: ${domain}`);
}

/** Ein Wert, der in einfachen Anführungszeichen in die .env kommt */
function pruefeWoertlich(wert: string, option: string): void {
  if (/['\r\n]/.test(wert)) abbrechen(`${option} darf weder ' noch einen Zeilenumbruch enthalten.`);
}

export function pruefeAngaben(a: NeuAngaben): void {
  pruefeName(a.name);
  pruefeDomain(a.domain);
  // Wie ELSTER_HERSTELLER_ID in apps/web/src/server/env.ts: die App startet sonst nicht
  if (a.herstellerId !== undefined && !/^\d{5}$/.test(a.herstellerId)) abbrechen("Die Hersteller-ID besteht aus fünf Ziffern.");
  if (a.ericHome !== undefined && !/^\/[A-Za-z0-9._/-]+$/.test(a.ericHome)) abbrechen("--eric-home braucht einen absoluten Pfad ohne Leerzeichen.");
  if (a.sso) {
    if (!a.sso.issuer.startsWith("https://")) abbrechen("--oidc-issuer muss mit https:// beginnen.");
    pruefeWoertlich(a.sso.issuer, "--oidc-issuer");
    pruefeWoertlich(a.sso.clientId, "--oidc-client-id");
    pruefeWoertlich(a.sso.clientSecret, "--oidc-client-secret");
    pruefeWoertlich(a.sso.anzeigename, "--oidc-name");
  }
}

const DOCKER_TOT = "docker antwortet nicht (läuft der Daemon, darfst du ihn nutzen?); nichts angelegt.";

/** Gibt es schon etwas mit diesem Namen oder dieser Domain? Vorhandenes bleibt unangetastet, vor allem .env und Schlüssel */
export async function pruefeTrennung(k: Kontext, name: string, domain: string): Promise<void> {
  const dir = join(k.basis, name);
  if (existsSync(dir)) abbrechen(`${dir} gibt es schon; nichts geändert.`);
  const projekt = `haben-${name}`;
  for (const andere of await instanzen(k.basis)) {
    if (andere.env.get("DOMAIN") === domain) abbrechen(`Die Domain ${domain} gehört schon zur Instanz ${andere.name}.`);
    // Gleiches Projekt hieße gleiche Container, Volumes und gleicher Name im Netz des Proxys, etwa bei einer
    // Instanz haben-firma1, die von Hand nach der Doku angelegt ist
    if (andere.env.get("COMPOSE_PROJECT_NAME") === projekt)
      abbrechen(`Das Compose-Projekt ${projekt} gehört schon zur Instanz ${andere.dir}; bitte einen anderen Namen wählen.`);
  }
  // Ein übrig gebliebener Eintrag einer gelöschten Instanz: zwei Blöcke für dieselbe Domain lehnt Caddy ab
  // („ambiguous site definition“), und der gemeinsame Proxy startete für keine Instanz mehr
  const sites = join(proxyDir(k), "sites");
  const dateien = existsSync(sites) ? (await readdir(sites)).filter((d) => d.endsWith(".caddy") && d !== `${name}.caddy`) : [];
  for (const datei of dateien) {
    const zeilen = (await readFile(join(sites, datei), "utf8")).split("\n");
    if (zeilen.includes(`${domain} {`)) abbrechen(`Für ${domain} steht schon ein Eintrag im gemeinsamen Caddy (${join(sites, datei)}); nichts angelegt.`);
  }
  // Auch ein Projekt dieses Namens außerhalb der Basis: mit Containern oder, nach docker compose down, nur noch mit
  // seinen Volumes (Datenbank und Belege einer anderen Firma). Kann docker das nicht sagen, lieber nichts anlegen
  const projekte = await docker(k, ["compose", "ls", "-a", "-q"]);
  if (projekte.code !== 0) abbrechen(DOCKER_TOT);
  if (projekte.stdout.split("\n").some((p) => p.trim() === projekt))
    abbrechen(`Docker kennt schon ein Compose-Projekt ${projekt}; bitte einen anderen Namen wählen.`);
  const volumes = await docker(k, ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projekt}`]);
  if (volumes.code !== 0) abbrechen(DOCKER_TOT);
  const vorhanden = volumes.stdout.split("\n").filter((v) => v.trim() !== "");
  if (vorhanden.length > 0) abbrechen(`Es gibt schon Volumes des Compose-Projekts ${projekt} (${vorhanden.join(" ")}); bitte einen anderen Namen wählen.`);
}
