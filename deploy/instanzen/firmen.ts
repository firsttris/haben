/**
 * firmen [<name> …]: dieselbe Liste HABEN_FIRMEN in jeder gewählten Instanz, damit die Navigation zwischen ihnen
 * wechselt (#909, docs/installation.md, „Firma wechseln“). Ohne Namen alle Instanzen der Basis.
 *
 * Erst alles prüfen, dann schreiben: Eine Liste, die die App ablehnt, ließe nach dem Neustart keine der Apps mehr
 * starten (apps/web/src/server/env.ts). Die Regeln der App (parseFirmen in apps/web/src/lib/firmen.ts) stehen hier
 * noch einmal, weil das Werkzeug ohne bun install läuft; firmen-app.test.ts hält beide zusammen.
 */
import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { compose } from "./ausfuehren.ts";
import { envSchreiben, envSetzen } from "./env-datei.ts";
import { type Instanz, instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { tabelle } from "./liste.ts";
import { dienste, lauf, wartenAufApp } from "./zustand.ts";

const MAX_FIRMEN = 50;
const MAX_NAME = 60;
const DOMAIN = /^[a-z0-9._-]+$/;

/**
 * Wie die App, dazu strenger: kein ' (der Wert steht in einfachen Anführungszeichen in der .env), kein \ am Ende
 * (Compose liest \' als Zeichen, compose-go dotenv/parser.go, extractVarValue; HABEN_FIRMENNAME endete nie) und kein
 * Leerraum am Rand (die App schneidet ihn ab, „Nord“ und „Nord “ sähen gleich aus)
 */
export function pruefeFirmenname(name: string, herkunft: string): void {
  if (name.length === 0 || name.length > MAX_NAME || /\p{Cc}/u.test(name))
    abbrechen(`${herkunft}: Der Firmenname braucht 1 bis ${MAX_NAME} Zeichen ohne Steuerzeichen: „${name}“`);
  if (/[|;']/.test(name)) abbrechen(`${herkunft}: Der Firmenname darf weder | noch ; noch ' enthalten: „${name}“`);
  if (name.endsWith("\\")) abbrechen(`${herkunft}: Der Firmenname darf nicht mit \\ enden: „${name}“`);
  if (name.trim() !== name) abbrechen(`${herkunft}: Der Firmenname darf nicht mit Leerraum beginnen oder enden: „${name}“`);
}

/** Origin von https://<domain>, wie die App ihn annimmt: nur die Domain, ohne Pfad, Query und Zugangsdaten */
function adresse(instanz: string, domain: string): string {
  const roh = `https://${domain}`;
  const url = URL.canParse(roh) ? new URL(roh) : undefined;
  const nurDomain = url && DOMAIN.test(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  if (!url || !nurDomain || /[?#]/.test(roh)) abbrechen(`${instanz}: DOMAIN in der .env ist keine Domain ohne Pfad: „${domain}“`);
  return url.origin;
}

/** Die Liste für HABEN_FIRMEN; bricht beim ersten Fehler ab und nennt die Instanz */
export function firmenListe(eintraege: { instanz: string; name: string; domain: string }[]): string {
  if (eintraege.length > MAX_FIRMEN) abbrechen(`Höchstens ${MAX_FIRMEN} Firmen in der Liste zum Wechseln, gewählt sind ${eintraege.length}; nichts geändert.`);
  const gesehen = new Map<string, string>();
  const liste: string[] = [];
  for (const { instanz, name, domain } of eintraege) {
    pruefeFirmenname(name, instanz);
    const url = adresse(instanz, domain);
    const gleicherName = gesehen.get(`name:${name}`);
    if (gleicherName) abbrechen(`Den Firmennamen „${name}“ tragen ${gleicherName} und ${instanz}; HABEN_FIRMENNAME in einer davon ändern. Nichts geändert.`);
    const gleicheUrl = gesehen.get(`url:${url}`);
    if (gleicheUrl) abbrechen(`Die Adresse ${url} nennen ${gleicheUrl} und ${instanz} in DOMAIN; nichts geändert.`);
    gesehen.set(`name:${name}`, instanz).set(`url:${url}`, instanz);
    liste.push(`${name}|${url}`);
  }
  return liste.join(";");
}

/** Eintrag einer Instanz in der Liste: HABEN_FIRMENNAME, sonst ihr Name */
const firmenname = (i: Instanz) => i.env.get("HABEN_FIRMENNAME") ?? i.name;

/** Gibt compose.yml HABEN_FIRMEN an die App weiter? Die Vorlage tut es erst seit #905 */
async function reichtDurch(i: Instanz): Promise<boolean> {
  return /^\s*HABEN_FIRMEN:/m.test(await readFile(join(i.dir, "compose.yml"), "utf8"));
}

function auswaehlen(alle: Instanz[], namen: string[]): Instanz[] {
  const unbekannt = namen.filter((n) => !alle.some((i) => i.name === n));
  if (unbekannt.length > 0) abbrechen(`Keine Instanz unter der Basis: ${unbekannt.join(" ")} (siehe liste); nichts geändert.`);
  return namen.length === 0 ? alle : alle.filter((i) => namen.includes(i.name));
}

/** Adressen in HABEN_FIRMEN, ohne Prüfung: Die Liste einer nicht gewählten Instanz kann von Hand stammen */
function adressen(liste: string): string[] {
  return liste.split(";").flatMap((e) => {
    const roh = e.split("|")[1]?.trim() ?? "";
    return URL.canParse(roh) ? [new URL(roh).origin] : [];
  });
}

/** Nicht gewählte Instanzen, deren Liste noch gewählte nennt, mit deren Namen; sie bleiben, wie sie sind */
function veraltet(alle: Instanz[], gewaehlt: Instanz[], urls: string[]): [string, string[]][] {
  return alle
    .filter((i) => !gewaehlt.includes(i))
    .map((i): [string, string[]] => {
      const genannt = adressen(i.env.get("HABEN_FIRMEN") ?? "");
      return [i.name, gewaehlt.filter((_, n) => genannt.includes(urls[n] ?? "")).map((g) => g.name)];
    })
    .filter(([, genannt]) => genannt.length > 0);
}

/**
 * Schreibt erst jede neue .env in eine Datei daneben und ersetzt dann alle mit rename: Scheitert das Schreiben bei
 * einer Instanz, bleibt jede .env, wie sie war
 */
async function ersetzen(dateien: { dir: string; text: string }[]): Promise<void> {
  const neu = (dir: string) => join(dir, ".env.firmen-neu");
  try {
    for (const { dir, text } of dateien) await envSchreiben(neu(dir), text);
  } catch (error) {
    for (const { dir } of dateien) await rm(neu(dir), { force: true }).catch(() => undefined);
    throw error;
  }
  for (const { dir } of dateien) await rename(neu(dir), join(dir, ".env"));
}

export async function firmen(k: Kontext, namen: string[]): Promise<void> {
  const alle = await instanzen(k.basis);
  const gewaehlt = auswaehlen(alle, namen);
  const liste = firmenListe(gewaehlt.map((i) => ({ instanz: i.name, name: firmenname(i), domain: i.env.get("DOMAIN") ?? "" })));

  const laufend: Instanz[] = [];
  const gestoppt: string[] = [];
  for (const i of gewaehlt) {
    if (!(await reichtDurch(i)))
      abbrechen(`${i.dir}/compose.yml gibt HABEN_FIRMEN nicht an die App weiter; die aktuelle deploy/compose.yml dorthin kopieren. Nichts geändert.`);
    const zustand = lauf(await dienste(k, i.dir), "app");
    if (zustand === "fehler") abbrechen(`${i.name}: docker compose meldet einen Fehler (cd ${i.dir} && docker compose ps); nichts geändert.`);
    if (zustand === "neustart") abbrechen(`${i.name}: Die App startet ständig neu; siehe: cd ${i.dir} && docker compose logs app. Nichts geändert.`);
    if (zustand === "laeuft") laufend.push(i);
    else gestoppt.push(i.name);
  }

  const geaendert: { dir: string; text: string }[] = [];
  for (const i of gewaehlt) {
    const alt = await readFile(join(i.dir, ".env"), "utf8");
    const neu = envSetzen(alt, "HABEN_FIRMEN", liste, true);
    if (neu !== alt) geaendert.push({ dir: i.dir, text: neu });
  }
  await ersetzen(geaendert);
  // Wie update: up -d bringt die App auf den Stand ihrer .env; einen unveränderten Container erstellt Compose nicht neu
  for (const i of laufend) {
    const rest = "Die .env aller gewählten Instanzen hat die neue Liste; die folgenden laufen noch mit der alten.";
    if ((await compose(k, i.dir, ["up", "-d"], true)).code !== 0) abbrechen(`${i.name}: Neustart fehlgeschlagen. ${rest}`);
    if (!(await wartenAufApp(k, i.dir)))
      abbrechen(`${i.name}: Die App ist nach dem Neustart nicht gesund; siehe: cd ${i.dir} && docker compose logs app. ${rest}`);
  }

  for (const zeile of tabelle(gewaehlt.map((i) => [i.name, i.env.get("DOMAIN") ?? "", firmenname(i)]))) k.aus(zeile);
  if (gestoppt.length > 0) k.aus(`Gestoppt, nur die .env geändert: ${gestoppt.join(" ")}`);
  for (const [name, genannt] of veraltet(alle, gewaehlt, adressen(liste)))
    k.aus(`Hinweis: ${name} ist nicht gewählt und nennt in HABEN_FIRMEN noch ${genannt.join(", ")}; sie bleibt unverändert.`);
}
