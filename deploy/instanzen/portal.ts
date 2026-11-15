/**
 * portal [<domain> --oidc-…]: richtet beim ersten Aufruf das Firmenportal unter <basis>/firmenportal ein, hinter dem
 * gemeinsamen Caddy, und gleicht es bei jedem Aufruf mit den Instanzen ab (portal-abgleich.ts; docs/installation.md,
 * „Mit dem Werkzeug“, `portal`). Eine Sperrdatei hält zwei Läufe auseinander, etwa cron und einen von Hand.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { docker } from "./ausfuehren.ts";
import { envSchreiben, envSetzen, envWert } from "./env-datei.ts";
import { instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { abgleichen, PORTAL_DIENST } from "./portal-abgleich.ts";
import { domainImCaddy, netzFuer, proxyDir, proxyEintragen, proxyStarten } from "./proxy.ts";
import { type NeuAngaben, pruefeDomain, pruefeSso } from "./pruefen.ts";

/** Verzeichnis, Name im gemeinsamen Caddy und Netz; als Name einer Instanz reserviert (pruefeName) */
export const PORTAL = "firmenportal";

export interface PortalAngaben {
  domain?: string;
  sso?: NeuAngaben["sso"];
}

const base64 = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64");

/**
 * Die .env aus firmenportal.env.example. COMPOSE_PROJECT_NAME ohne haben- davor: Sonst hielte instanzen() das
 * Firmenportal für eine Instanz, und update, status und firmen liefen auch dort.
 */
export function portalEnv(vorlage: string, domain: string, sso: NonNullable<NeuAngaben["sso"]>): string {
  const werte: [string, string, boolean?][] = [
    ["COMPOSE_PROJECT_NAME", PORTAL],
    ["PORTAL_URL", `https://${domain}`],
    ["PORTAL_SECRET", base64(32)],
    ["PORTAL_FIRMEN", "", true],
    ["OIDC_ISSUER", sso.issuer, true],
    ["OIDC_CLIENT_ID", sso.clientId, true],
    ["OIDC_CLIENT_SECRET", sso.clientSecret, true],
    ["OIDC_DISPLAY_NAME", sso.anzeigename, true],
  ];
  return werte.reduce((text, [key, wert, woertlich]) => envSetzen(text, key, wert, woertlich), `COMPOSE_PROJECT_NAME=\n${vorlage}`);
}

/**
 * Die Vorlage ohne den Port auf 127.0.0.1: Compose hängt `ports` aus einer Override-Datei an, statt sie zu ersetzen
 * (`!reset` gibt es erst ab Compose 2.24), und hinter dem gemeinsamen Caddy wäre der Port ein Weg an ihm vorbei
 */
export function portalCompose(vorlage: string): string {
  const ohnePort = vorlage.replace(/\n(?:[ \t]*#[^\n]*\n)*[ \t]*ports:\n(?:[ \t]*- [^\n]*\n)+/, "\n");
  if (ohnePort === vorlage || /^\s*ports:/m.test(ohnePort))
    abbrechen("deploy/firmenportal/compose.yml hat einen Aufbau, den portal nicht kennt; nichts angelegt.");
  return ohnePort;
}

/** Wie bei einer Instanz: im eigenen Netz zum Caddy, dort als haben-firmenportal:3000 erreichbar */
export function portalOverride(): string {
  return [
    `# Angelegt von haben-instanzen.ts: Firmenportal im eigenen Netz ${netzFuer(PORTAL)} zum Proxy als haben-${PORTAL}:3000`,
    "services:",
    `  ${PORTAL_DIENST}:`,
    "    networks:",
    "      default:",
    "      proxy:",
    `        aliases: [haben-${PORTAL}]`,
    "networks:",
    "  proxy:",
    "    external: true",
    `    name: ${netzFuer(PORTAL)}`,
    "",
  ].join("\n");
}

async function einrichten(k: Kontext, dir: string, domain: string, sso: NonNullable<NeuAngaben["sso"]>): Promise<void> {
  pruefeDomain(domain);
  pruefeSso(sso);
  const alle = await instanzen(k.basis);
  // Mit --eigener-proxy gibt es keinen gemeinsamen Caddy; proxyEintragen legte sonst einen zweiten an, der um die
  // Ports 80 und 443 mit dem eigenen Proxy stritte
  if (alle.length > 0 && !existsSync(join(proxyDir(k), "compose.yml")))
    abbrechen(
      "Die Instanzen laufen ohne den gemeinsamen Caddy (--eigener-proxy); das Firmenportal dann von Hand einrichten (docs/installation.md, „Firmenportal“). Nichts angelegt.",
    );
  const andere = alle.find((i) => i.env.get("DOMAIN") === domain);
  if (andere) abbrechen(`Die Domain ${domain} gehört schon zur Instanz ${andere.name}; nichts angelegt.`);
  const site = await domainImCaddy(k, domain, PORTAL);
  if (site) abbrechen(`Für ${domain} steht schon ein Eintrag im gemeinsamen Caddy (${site}); nichts angelegt.`);
  if (existsSync(dir)) abbrechen(`${dir} gibt es schon, aber ohne .env; bitte prüfen und entfernen. Nichts angelegt.`);
  // Ein Firmenportal von Hand nach der Doku in einem Verzeichnis firmenportal heißt auch so; seine Container übernähme
  // portal sonst ungefragt
  const projekte = await docker(k, ["compose", "ls", "-a", "-q"]);
  if (projekte.code !== 0) abbrechen("docker antwortet nicht (läuft der Daemon, darfst du ihn nutzen?); nichts angelegt.");
  if (projekte.stdout.split("\n").some((p) => p.trim() === PORTAL))
    abbrechen(`Docker kennt schon ein Compose-Projekt ${PORTAL}, etwa ein von Hand eingerichtetes Firmenportal; nichts angelegt.`);

  await mkdir(k.basis, { recursive: true });
  const neu = await mkdtemp(join(k.basis, `.neu-${PORTAL}-`));
  try {
    const vorlagen = join(k.vorlagen, "firmenportal");
    await writeFile(join(neu, "compose.yml"), portalCompose(await readFile(join(vorlagen, "compose.yml"), "utf8")));
    await envSchreiben(join(neu, ".env"), portalEnv(await readFile(join(vorlagen, "firmenportal.env.example"), "utf8"), domain, sso));
    await writeFile(join(neu, "compose.override.yml"), portalOverride());
    await mkdir(join(neu, "logos"), { mode: 0o755 });
    await rename(neu, dir);
  } catch (error) {
    await rm(neu, { recursive: true, force: true });
    throw error;
  }
  await proxyEintragen(k, PORTAL, domain);
  await proxyStarten(k);
  k.aus(`Angelegt: ${dir}`);
  k.aus(`Im Anmeldedienst: Client ${sso.clientId} mit redirect_uris: [https://${domain}/callback], als Rückweg nach dem Abmelden`);
  k.aus(`https://${domain}/?abgemeldet=dienst (docs/installation.md, „Firmenportal“).`);
}

/** Nur ein Lauf zur Zeit; bleibt die Datei nach einem Absturz liegen, sagt die Meldung, was zu tun ist */
async function gesperrt<T>(dir: string, lauf: () => Promise<T>): Promise<T> {
  const sperre = join(dir, ".abgleich.lock");
  const datei = await open(sperre, "wx").catch((error: unknown) => {
    if ((error as { code?: string }).code === "EEXIST")
      abbrechen(`Ein anderer Abgleich läuft gerade (${sperre}). Ist keiner mehr aktiv, etwa nach einem Absturz, die Datei löschen.`);
    throw error;
  });
  try {
    await datei.writeFile(`${process.pid}\n`);
    await datei.close();
    return await lauf();
  } finally {
    await rm(sperre, { force: true });
  }
}

export async function portal(k: Kontext, a: PortalAngaben): Promise<void> {
  const dir = join(k.basis, PORTAL);
  const env = join(dir, ".env");
  const vorhanden = existsSync(env);
  if (vorhanden) {
    const text = await readFile(env, "utf8");
    // Eine Instanz, die vor portal firmenportal hieß (der Name ist erst seitdem reserviert), bleibt unberührt
    if (envWert(text, "COMPOSE_PROJECT_NAME") !== PORTAL) abbrechen(`${dir} ist nicht das Firmenportal (COMPOSE_PROJECT_NAME); nichts geändert.`);
    const url = envWert(text, "PORTAL_URL") ?? "";
    const eingerichtet = URL.canParse(url) ? new URL(url).hostname : url;
    if (a.domain !== undefined && a.domain !== eingerichtet)
      abbrechen(`Das Firmenportal ist schon für ${eingerichtet} eingerichtet (${env}); nichts geändert.`);
    if (a.sso) abbrechen(`Das Firmenportal ist schon eingerichtet; die Anmeldung steht in ${env}. Nichts geändert.`);
  } else {
    if (a.domain === undefined || !a.sso)
      abbrechen(
        "Das Firmenportal ist noch nicht eingerichtet: portal <domain> --oidc-issuer URL --oidc-client-id ID (--oidc-client-secret-file PFAD | --oidc-client-secret-stdin)",
      );
    await einrichten(k, dir, a.domain, a.sso);
  }
  await gesperrt(dir, () => abgleichen(k, dir, !vorhanden));
}
