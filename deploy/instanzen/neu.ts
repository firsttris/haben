/**
 * neu <name> <domain>: legt eine Instanz an und startet sie. Erst alles in einem versteckten Verzeichnis neben dem
 * Ziel, dann ein rename; bricht etwas ab, bleibt kein halbes Verzeichnis zurück.
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose, docker } from "./ausfuehren.ts";
import { envSchreiben, envSetzen, envWerte } from "./env-datei.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { CADDY_RELOAD, caddyBlock, NETZ, proxyDir, proxyEintragen, proxyStarten } from "./proxy.ts";
import { type NeuAngaben, pruefeAngaben, pruefeTrennung } from "./pruefen.ts";
import { wartenAufApp } from "./zustand.ts";

function zufall(bytes: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

const hex = (bytes: number) => Buffer.from(zufall(bytes)).toString("hex");
const base64 = (bytes: number) => Buffer.from(zufall(bytes)).toString("base64");

/** Rolle des laufenden Servers; Eigentümer und Migrationen bleiben bei haben (docs/installation-konfiguration.md) */
const APP_ROLLE = "haben_app";
const CREATEUSER = ["createuser", "-U", "haben", "--login", "--no-superuser", "--no-createdb", "--no-createrole", "--pwprompt", APP_ROLLE];

/** Die .env aus compose.env.example mit eigenen Zufallswerten und Namen dieser Instanz */
export function envFuer(vorlage: string, a: NeuAngaben): string {
  const projekt = `haben-${a.name}`;
  const werte: [string, string, boolean?][] = [
    ["COMPOSE_PROJECT_NAME", projekt],
    ["DOMAIN", a.domain],
    // Wie in compose.env.example: openssl rand -hex 24 bzw. -base64 32
    ["DB_PASSWORD", hex(24)],
    // Eigenes Passwort der App-Rolle statt des Platzhalters der Vorlage; MIGRATION_DATABASE_URL bleibt, wie sie ist
    ["DATABASE_URL", `postgres://${APP_ROLLE}:${hex(24)}@db:5432/haben`],
    ["AUTH_SECRET", base64(32)],
    ["ENCRYPTION_KEY", base64(32)],
    ["RESTIC_PASSWORD", base64(32)],
    // Eigener Name je Instanz, falls sich mehrere ein restic-Repository teilen
    ["BACKUP_HOST", projekt],
  ];
  if (a.herstellerId !== undefined) werte.push(["ELSTER_HERSTELLER_ID", a.herstellerId]);
  if (a.ericHome !== undefined) werte.push(["ERIC_HOME", a.ericHome]);
  if (a.sso) {
    werte.push(
      ["OIDC_ONLY", "true"],
      ["OIDC_ISSUER", a.sso.issuer, true],
      ["OIDC_CLIENT_ID", a.sso.clientId, true],
      ["OIDC_CLIENT_SECRET", a.sso.clientSecret, true],
      ["OIDC_DISPLAY_NAME", a.sso.anzeigename, true],
      // Eindeutig je Instanz: Teilen sich Instanzen einen Anmeldedienst, wäre jedes Mitglied einer gemeinsamen
      // Inhaber-Gruppe Inhaber in allen Firmen
      ["OIDC_GROUP_INHABER", `${projekt}-inhaber`],
      ["OIDC_GROUP_STEUERBERATUNG", `${projekt}-steuerberatung`],
    );
  }
  return werte.reduce((text, [key, wert, woertlich]) => envSetzen(text, key, wert, woertlich), vorlage);
}

export function overrideFuer(a: NeuAngaben): string {
  const zeilen = [
    `# Angelegt von haben-instanzen.ts: eigener Caddy aus, App im Netz ${NETZ} als haben-${a.name}:3000`,
    "services:",
    "  caddy:",
    "    profiles: [eigener-proxy]",
    "  app:",
    "    networks:",
    "      default:",
    "      proxy:",
    `        aliases: [haben-${a.name}]`,
    ...(a.ericHome ? ["    volumes:", `      - ${a.ericHome}:${a.ericHome}:ro`] : []),
    "networks:",
    "  proxy:",
    "    external: true",
    `    name: ${NETZ}`,
  ];
  return `${zeilen.join("\n")}\n`;
}

/** Schreibt die drei Dateien der Instanz in ein verstecktes Verzeichnis und benennt es erst am Ende um */
async function anlegen(k: Kontext, a: NeuAngaben, dir: string): Promise<void> {
  await mkdir(k.basis, { recursive: true });
  const neu = await mkdtemp(join(k.basis, `.neu-${a.name}-`));
  try {
    await copyFile(join(k.vorlagen, "compose.yml"), join(neu, "compose.yml"));
    await envSchreiben(join(neu, ".env"), envFuer(await readFile(join(k.vorlagen, "compose.env.example"), "utf8"), a));
    await writeFile(join(neu, "compose.override.yml"), overrideFuer(a));
    await rename(neu, dir);
  } catch (error) {
    await rm(neu, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Die App-Rolle muss es geben, bevor die App startet: Der Start legt keine Rolle an. Das Passwort steht in
 * DATABASE_URL der .env und geht über die Standardeingabe an createuser (--pwprompt fragt zweimal), nicht als
 * Argument.
 */
async function appRolleAnlegen(k: Kontext, a: NeuAngaben, dir: string): Promise<void> {
  const url = envWerte(await readFile(join(dir, ".env"), "utf8")).get("DATABASE_URL") ?? "";
  const passwort = URL.canParse(url) ? new URL(url).password : "";
  if (passwort === "") abbrechen(`In ${dir}/.env fehlt das Passwort der App-Rolle in DATABASE_URL.`);
  if ((await compose(k, dir, ["up", "-d", "--wait", "db"], true)).code !== 0)
    abbrechen(`Die Datenbank von ${a.name} ließ sich nicht starten; siehe: cd ${dir} && docker compose logs db`);
  if ((await compose(k, dir, ["exec", "-T", "db", ...CREATEUSER], false, `${passwort}\n${passwort}\n`)).code !== 0)
    abbrechen(`Die App-Rolle ${APP_ROLLE} von ${a.name} ließ sich nicht anlegen; die App ist nicht gestartet. Siehe: cd ${dir} && docker compose logs db`);
}

/**
 * Der erste Start von Hand, in der Reihenfolge von starten(): nach --nicht-starten und nach einem Abbruch, bevor es
 * die App-Rolle gibt. `neu` lässt sich für dieselbe Instanz nicht wiederholen, und `docker compose up -d` allein
 * startet eine App, die sich als haben_app nicht anmelden kann.
 */
function ersterStart(k: Kontext, a: NeuAngaben, dir: string): string[] {
  return [
    a.eigenerProxy
      ? `  docker network inspect ${NETZ} > /dev/null 2>&1 || docker network create ${NETZ}`
      : `  cd ${proxyDir(k)} && docker compose up -d && docker compose ${CADDY_RELOAD.join(" ")}`,
    `  cd ${dir} && docker compose up -d --wait db`,
    `  docker compose exec db ${CREATEUSER.join(" ")}`,
    "  docker compose up -d",
  ];
}

/** Proxy bzw. Netz, Datenbank und App-Rolle; bricht davon etwas ab, stehen die Schritte zum Nachholen in der Meldung */
async function vorDerApp(k: Kontext, a: NeuAngaben, dir: string): Promise<void> {
  try {
    if (a.eigenerProxy) {
      if ((await docker(k, ["network", "inspect", NETZ])).code !== 0 && (await docker(k, ["network", "create", NETZ])).code !== 0)
        abbrechen(`Das Netz ${NETZ} ließ sich nicht anlegen.`);
    } else await proxyStarten(k);
    await appRolleAnlegen(k, a, dir);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "Abbruch") throw error;
    abbrechen(
      [error.message, `Den Start danach von Hand nachholen, mit dem Passwort aus DATABASE_URL in ${dir}/.env für createuser:`, ...ersterStart(k, a, dir)].join(
        "\n",
      ),
    );
  }
}

async function starten(k: Kontext, a: NeuAngaben, dir: string): Promise<void> {
  await vorDerApp(k, a, dir);
  if ((await compose(k, dir, ["up", "-d"], true)).code !== 0)
    abbrechen(`Die Instanz ${a.name} ließ sich nicht starten; siehe: cd ${dir} && docker compose logs`);
  if (!(await wartenAufApp(k, dir))) abbrechen(`Die App von ${a.name} ist nicht gesund geworden; siehe: cd ${dir} && docker compose logs app`);
}

export async function neu(k: Kontext, a: NeuAngaben): Promise<void> {
  pruefeAngaben(a);
  await pruefeTrennung(k, a.name, a.domain);
  const dir = join(k.basis, a.name);
  await anlegen(k, a, dir);
  k.aus(`Angelegt: ${dir}`);
  k.aus(`ENCRYPTION_KEY und RESTIC_PASSWORD aus ${dir}/.env zusätzlich an einem zweiten Ort sichern (Passwortmanager).`);

  if (a.eigenerProxy) {
    k.aus("");
    k.aus(`Für deinen Proxy (Container im Netz ${NETZ}, z. B. docker network connect ${NETZ} <proxy>):`);
    k.aus(caddyBlock(a.domain, a.name).trimEnd());
  } else await proxyEintragen(k, a.name, a.domain);

  if (a.sso) {
    k.aus("");
    k.aus(`Im Anmeldedienst: Gruppen haben-${a.name}-inhaber und haben-${a.name}-steuerberatung anlegen, Client ${a.sso.clientId} mit`);
    k.aus(`  redirect_uris: [https://${a.domain}/api/auth/callback/oidc]`);
    k.aus("(vollständiges Beispiel für Authelia: docs/installation-sso.md, „Authelia konfigurieren“).");
  }

  if (!a.starten) {
    k.aus(`Nicht gestartet (--nicht-starten). Der erste Start, mit dem Passwort aus DATABASE_URL in ${dir}/.env für createuser:`);
    for (const zeile of ersterStart(k, a, dir)) k.aus(zeile);
    return;
  }
  await starten(k, a, dir);
  k.aus("");
  if (a.sso) {
    k.aus(`Fertig. Einrichten: https://${a.domain}/setup, angemeldet als Mitglied von haben-${a.name}-inhaber.`);
    return;
  }
  const logs = await compose(k, dir, ["logs", "app"]);
  const code = logs.stdout
    .split("\n")
    .filter((z) => z.includes("Einrichtungscode"))
    .at(-1);
  if (code) k.aus(code.replace(/^[^|]*\| /, ""));
  k.aus(`Fertig. Einrichten: https://${a.domain}/setup mit dem Einrichtungscode.`);
}
