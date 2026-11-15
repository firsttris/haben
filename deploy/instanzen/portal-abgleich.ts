/**
 * Abgleich des Firmenportals mit den Instanzen (#504, #1036): PORTAL_FIRMEN aus allen Instanzen mit SSO, dazu Farbe
 * und Logo jeder Firma, und HABEN_FIRMENPORTAL_URL in jeder dieser Instanzen. Mehrfach aufrufbar, etwa stündlich aus
 * cron: Geschrieben wird nur, was sich ändert, neu gestartet nur, was eine geänderte Datei hat.
 *
 * Die Regeln für PORTAL_FIRMEN (parsePortalFirmen in packages/core/src/firmen.ts) stehen hier noch einmal, weil das
 * Werkzeug ohne bun install läuft; portal-app.test.ts hält beide zusammen.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose } from "./ausfuehren.ts";
import { envSchreiben, envSetzen, envWerte } from "./env-datei.ts";
import { adresse, pruefeFirmenname } from "./firmen.ts";
import { type Instanz, instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { tabelle } from "./liste.ts";
import { KEIN_ZEICHEN, logoPruefen, sha256, type Zeichen, zeichenAus } from "./portal-zeichen.ts";
import { dienste, lauf, wartenAufApp } from "./zustand.ts";

const MAX_FIRMEN = 50;
const MAX_GRUPPE = 100;
/** Name der Logo-Dateien, wie parsePortalFirmen sie annimmt; nur solche räumt der Abgleich auch weg */
const LOGO_DATEI = /^[a-z0-9][a-z0-9_-]*\.(png|jpg)$/;
export const PORTAL_DIENST = "firmenportal";
/** Name des Firmenportals in der Liste der offenen Neustarts */
const PORTAL = "firmenportal";

/** Eine Firma im Firmenportal, wie sie in PORTAL_FIRMEN steht */
interface Eintrag {
  instanz: Instanz;
  name: string;
  url: string;
  gruppe: string;
  zeichen: Zeichen;
  /** Dateiname in logos/, wenn das Logo da ist */
  logo: string | null;
}

/** Was in eine Datei soll; `inhalt` null heißt löschen */
interface Datei {
  pfad: string;
  inhalt: string | Uint8Array | null;
  /** .env nur für den Besitzer, Logos für den Container lesbar */
  geheim: boolean;
}

/** Die Inhaber-Gruppe, wie das Firmenportal sie annimmt; dazu ohne | ; ', weil der Wert wörtlich in der .env steht */
function pruefeGruppe(i: Instanz, gruppe: string | undefined): string {
  if (!gruppe) abbrechen(`${i.name}: OIDC_GROUP_INHABER fehlt in ${i.dir}/.env; ohne Gruppe sähe niemand die Firma. Nichts geändert.`);
  if (gruppe.length > MAX_GRUPPE || /[\s\p{Cc}|;']/u.test(gruppe))
    abbrechen(`${i.name}: OIDC_GROUP_INHABER braucht 1 bis ${MAX_GRUPPE} Zeichen ohne Leerraum, |, ; und ': „${gruppe}“. Nichts geändert.`);
  return gruppe;
}

/** Farbe und Logo je Adresse aus dem bisherigen PORTAL_FIRMEN, für Instanzen, die gerade nicht laufen */
function bisherige(liste: string): Map<string, { farbe: string | null; logo: string | null }> {
  const bisher = new Map<string, { farbe: string | null; logo: string | null }>();
  for (const eintrag of liste.split(";")) {
    const [, url, , farbe, logo] = eintrag.split("|").map((t) => t.trim());
    if (url) bisher.set(url, { farbe: farbe || null, logo: logo || null });
  }
  return bisher;
}

/** Gibt compose.yml der Instanz HABEN_FIRMENPORTAL_URL an die App weiter? Die Vorlage tut es erst seit #1006 */
async function reichtDurch(i: Instanz): Promise<boolean> {
  return /^\s*HABEN_FIRMENPORTAL_URL:/m.test(await readFile(join(i.dir, "compose.yml"), "utf8"));
}

/** Die Instanzen mit SSO, geprüft und mit ihrem Lauf; ohne SSO bleiben sie außen vor */
async function auswaehlen(k: Kontext): Promise<{ mitSso: { i: Instanz; laeuft: boolean }[]; ohneSso: Instanz[] }> {
  const mitSso: { i: Instanz; laeuft: boolean }[] = [];
  const ohneSso: Instanz[] = [];
  for (const i of await instanzen(k.basis)) {
    if (i.env.get("OIDC_ONLY") !== "true") {
      ohneSso.push(i);
      continue;
    }
    if (!(await reichtDurch(i)))
      abbrechen(`${i.dir}/compose.yml gibt HABEN_FIRMENPORTAL_URL nicht an die App weiter; die aktuelle deploy/compose.yml dorthin kopieren. Nichts geändert.`);
    const zustand = lauf(await dienste(k, i.dir), "app");
    if (zustand === "fehler") abbrechen(`${i.name}: docker compose meldet einen Fehler (cd ${i.dir} && docker compose ps); nichts geändert.`);
    if (zustand === "neustart") abbrechen(`${i.name}: Die App startet ständig neu; siehe: cd ${i.dir} && docker compose logs app. Nichts geändert.`);
    mitSso.push({ i, laeuft: zustand === "laeuft" });
  }
  if (mitSso.length > MAX_FIRMEN) abbrechen(`Höchstens ${MAX_FIRMEN} Firmen im Firmenportal, mit SSO sind es ${mitSso.length}; nichts geändert.`);
  return { mitSso, ohneSso };
}

/**
 * Das Logo einer laufenden Instanz: die vorhandene Datei, wenn ihre Prüfsumme stimmt, sonst neu aus
 * `haben kennzeichen`. null, wenn keins gewählt ist oder es nicht passt (mit Warnung).
 */
async function logoHolen(k: Kontext, logos: string, i: Instanz, zeichen: Zeichen, neu: Map<string, Uint8Array>): Promise<string | null> {
  if (!zeichen.logo) return null;
  const datei = `${i.name}.${zeichen.logo.format}`;
  const vorhanden = existsSync(join(logos, datei)) ? new Uint8Array(await readFile(join(logos, datei))) : null;
  if (vorhanden && sha256(vorhanden) === zeichen.logo.sha256) return datei;
  const r = await compose(k, i.dir, ["exec", "-T", "app", "haben", "kennzeichen"], false, undefined, true);
  const grund = r.code !== 0 || !r.daten ? `ließ sich nicht holen (Exit-Code ${r.code})` : logoPruefen(r.daten, zeichen.logo);
  if (grund || !r.daten) {
    k.fehler(`Warnung: Das Logo von ${i.name} ${grund}; das Firmenportal zeigt den Anfangsbuchstaben.`);
    return null;
  }
  neu.set(datei, r.daten);
  return datei;
}

/** Die Einträge mit Zeichen; laufende Instanzen fragt er, gestoppte behalten Farbe und Logo von bisher */
async function eintraege(k: Kontext, portalDir: string, mitSso: { i: Instanz; laeuft: boolean }[], bisher: string, neueLogos: Map<string, Uint8Array>) {
  const alt = bisherige(bisher);
  const logos = join(portalDir, "logos");
  const liste: Eintrag[] = [];
  const gesehen = new Map<string, string>();
  for (const { i, laeuft } of mitSso) {
    const name = i.env.get("HABEN_FIRMENNAME") ?? i.name;
    pruefeFirmenname(name, i.name);
    const url = adresse(i.name, i.env.get("DOMAIN") ?? "");
    const gruppe = pruefeGruppe(i, i.env.get("OIDC_GROUP_INHABER"));
    for (const [art, wert] of [
      ["Den Firmennamen", name],
      ["Die Adresse", url],
      ["Die Gruppe", gruppe],
    ] as const) {
      const andere = gesehen.get(`${art}:${wert}`);
      if (andere) abbrechen(`${art} „${wert}“ tragen ${andere} und ${i.name}; nichts geändert.`);
      gesehen.set(`${art}:${wert}`, i.name);
    }
    if (laeuft) {
      const r = await compose(k, i.dir, ["exec", "-T", "app", "haben", "status", "--json"]);
      const zeichen = r.code === 0 ? zeichenAus(r.stdout) : KEIN_ZEICHEN;
      liste.push({ instanz: i, name, url, gruppe, zeichen, logo: await logoHolen(k, logos, i, zeichen, neueLogos) });
    } else {
      const vorher = alt.get(url);
      const logo = vorher?.logo && existsSync(join(logos, vorher.logo)) ? vorher.logo : null;
      liste.push({ instanz: i, name, url, gruppe, zeichen: { farbe: vorher?.farbe ?? null, logo: null }, logo });
    }
  }
  return liste;
}

/** Ein Eintrag in PORTAL_FIRMEN; leere Felder am Ende fallen weg, eine Liste ohne Zeichen sieht aus wie vor #1036 */
const zeile = (e: Eintrag) => [e.name, e.url, e.gruppe, e.zeichen.farbe ?? "", e.logo ?? ""].join("|").replace(/\|+$/, "");

/** Erst alle neuen Dateien neben das Ziel, dann umbenennen: Scheitert das Schreiben, bleibt alles, wie es war */
async function schreiben(dateien: Datei[]): Promise<void> {
  const neu = (pfad: string) => `${pfad}.portal-neu`;
  const zuSchreiben = dateien.filter((d) => d.inhalt !== null);
  try {
    for (const d of zuSchreiben) {
      if (d.geheim) await envSchreiben(neu(d.pfad), d.inhalt as string);
      else {
        await writeFile(neu(d.pfad), d.inhalt as Uint8Array | string);
        // Für den Container lesbar (USER bun), auch bei umask 027 oder 077
        await chmod(neu(d.pfad), 0o644);
      }
    }
  } catch (error) {
    for (const d of zuSchreiben) await rm(neu(d.pfad), { force: true }).catch(() => undefined);
    throw error;
  }
  for (const d of zuSchreiben) await rename(neu(d.pfad), d.pfad);
  for (const d of dateien.filter((d) => d.inhalt === null)) await rm(d.pfad, { force: true });
}

/**
 * Die geänderten .env-Dateien der Instanzen: mit SSO die Adresse des Firmenportals und HABEN_FIRMEN leer (die App
 * lehnt beides zusammen ab); ohne SSO die Adresse wieder heraus, die das Werkzeug gesetzt hat (die App lehnt sie
 * ohne OIDC_ONLY ab)
 */
async function instanzDateien(liste: Eintrag[], ohneSso: Instanz[], portalUrl: string, geleert: string[]): Promise<{ i: Instanz; datei: Datei }[]> {
  const dateien: { i: Instanz; datei: Datei }[] = [];
  const pruefen = async (i: Instanz, aendern: (text: string) => string) => {
    const alt = await readFile(join(i.dir, ".env"), "utf8");
    const neu = aendern(alt);
    if (neu !== alt) dateien.push({ i, datei: { pfad: join(i.dir, ".env"), inhalt: neu, geheim: true } });
  };
  for (const { instanz: i } of liste)
    await pruefen(i, (alt) => {
      const neu = envSetzen(alt, "HABEN_FIRMENPORTAL_URL", portalUrl);
      if (!envWerte(neu).get("HABEN_FIRMEN")) return neu;
      geleert.push(i.name);
      return envSetzen(neu, "HABEN_FIRMEN", "", true);
    });
  for (const i of ohneSso.filter((i) => i.env.get("HABEN_FIRMENPORTAL_URL") === portalUrl))
    await pruefen(i, (alt) => envSetzen(alt, "HABEN_FIRMENPORTAL_URL", ""));
  return dateien;
}

/** Logos, die keine Firma mehr nennt, und neue oder geänderte */
async function logoDateien(logos: string, liste: Eintrag[], neu: Map<string, Uint8Array>): Promise<Datei[]> {
  const genannt = new Set(liste.flatMap((e) => (e.logo ? [e.logo] : [])));
  const vorhanden = existsSync(logos) ? (await readdir(logos)).filter((d) => LOGO_DATEI.test(d)) : [];
  return [
    ...[...neu].filter(([datei]) => genannt.has(datei)).map(([datei, inhalt]) => ({ pfad: join(logos, datei), inhalt, geheim: false })),
    ...vorhanden.filter((d) => !genannt.has(d)).map((d) => ({ pfad: join(logos, d), inhalt: null, geheim: false })),
  ];
}

/**
 * Neustarts, die noch ausstehen, als Zeilen „firmenportal up“, „firmenportal restart“ oder „instanz <name>“. Sie
 * stehen in einer Datei, bevor neu gestartet wird: Scheitert ein Neustart, sind die Dateien schon auf dem neuen
 * Stand, und erst diese Liste sagt dem nächsten Lauf, was er nachholen muss.
 */
const OFFEN = ".neustart-offen";

async function offenLesen(portalDir: string): Promise<Set<string>> {
  const datei = join(portalDir, OFFEN);
  if (!existsSync(datei)) return new Set();
  return new Set((await readFile(datei, "utf8")).split("\n").filter((z) => z.trim() !== ""));
}

const offenDatei = (portalDir: string, offen: Set<string>): Datei => ({
  pfad: join(portalDir, OFFEN),
  inhalt: offen.size > 0 ? `${[...offen].join("\n")}\n` : null,
  geheim: false,
});

/** Was neu gestartet werden muss: aus dieser Änderung und was ein abgebrochener Lauf schuldig blieb */
async function offeneNeustarts(k: Kontext, portalDir: string, envNeu: boolean, logosNeu: boolean, instanzenNeu: Instanz[], erstmals: boolean) {
  const offen = await offenLesen(portalDir);
  const stand = await dienste(k, portalDir);
  // Ohne Container (etwa wenn der erste Abgleich nach dem Einrichten abbrach) wie beim ersten Mal starten; einen
  // gestoppten Container startet nur, wer ihn gestoppt hat
  const ohneContainer = stand !== null && !stand.has(PORTAL_DIENST);
  // Compose erstellt den Container neu, wenn sich die .env geändert hat (env_file geht in die Konfiguration ein);
  // die Logos liest das Firmenportal nur beim Start
  if (erstmals || ohneContainer || envNeu) offen.add(`${PORTAL} up`);
  else if (logosNeu) offen.add(`${PORTAL} restart`);
  if (offen.has(`${PORTAL} up`)) offen.delete(`${PORTAL} restart`);
  for (const i of instanzenNeu) offen.add(`instanz ${i.name}`);
  return { offen, starten: erstmals || ohneContainer, portalLaeuft: lauf(stand, PORTAL_DIENST) === "laeuft" };
}

/** Arbeitet die offenen Neustarts ab und streicht jeden gelungenen aus der Datei; gestoppte bleiben gestoppt */
async function neuStarten(k: Kontext, portalDir: string, offen: Set<string>, starten: boolean, portalLaeuft: boolean, alle: Instanz[]) {
  const gestartet: string[] = [];
  const gestoppt: string[] = [];
  const erledigt = async (zeile: string) => {
    offen.delete(zeile);
    await schreiben([offenDatei(portalDir, offen)]);
  };
  for (const zeile of [...offen].filter((z) => z.startsWith(`${PORTAL} `))) {
    if (!starten && !portalLaeuft) continue;
    const befehl = zeile.endsWith(" up") ? ["up", "-d"] : ["restart", PORTAL_DIENST];
    if ((await compose(k, portalDir, befehl, true)).code !== 0)
      abbrechen(`Das Firmenportal ließ sich nicht starten; siehe: cd ${portalDir} && docker compose logs`);
    if (!(await wartenAufApp(k, portalDir, PORTAL_DIENST)))
      abbrechen(`Das Firmenportal ist nicht gesund geworden; siehe: cd ${portalDir} && docker compose logs ${PORTAL_DIENST}`);
    gestartet.push("Firmenportal");
    await erledigt(zeile);
  }
  const rest = "Die Dateien sind geschrieben; der nächste Lauf von portal startet nach, was noch aussteht.";
  for (const zeile of [...offen].filter((z) => z.startsWith("instanz "))) {
    const i = alle.find((i) => `instanz ${i.name}` === zeile);
    // Startet die App ständig neu, etwa weil sie die alte Adresse ohne SSO ablehnt, baut erst up -d sie mit der neuen
    // .env auf; nur eine gestoppte bleibt gestoppt
    const zustand = i ? lauf(await dienste(k, i.dir), "app") : "fehler";
    if (!i || (zustand !== "laeuft" && zustand !== "neustart")) {
      if (i) gestoppt.push(i.name);
      await erledigt(zeile);
      continue;
    }
    if ((await compose(k, i.dir, ["up", "-d"], true)).code !== 0) abbrechen(`${i.name}: Neustart fehlgeschlagen. ${rest}`);
    if (!(await wartenAufApp(k, i.dir)))
      abbrechen(`${i.name}: Die App ist nach dem Neustart nicht gesund; siehe: cd ${i.dir} && docker compose logs app. ${rest}`);
    gestartet.push(i.name);
    await erledigt(zeile);
  }
  return { gestartet, gestoppt, portalGestoppt: [...offen].some((z) => z.startsWith(`${PORTAL} `)) };
}

/** Der Abgleich; `erstmals` nach dem Einrichten */
export async function abgleichen(k: Kontext, portalDir: string, erstmals: boolean): Promise<void> {
  const envPfad = join(portalDir, ".env");
  const envAlt = await readFile(envPfad, "utf8");
  const portalUrl = envWerte(envAlt).get("PORTAL_URL") ?? "";
  const { mitSso, ohneSso } = await auswaehlen(k);
  const neueLogos = new Map<string, Uint8Array>();
  const liste = await eintraege(k, portalDir, mitSso, envWerte(envAlt).get("PORTAL_FIRMEN") ?? "", neueLogos);

  const envNeu = envSetzen(envAlt, "PORTAL_FIRMEN", liste.map(zeile).join(";"), true);
  const geleert: string[] = [];
  const instanzen = await instanzDateien(liste, ohneSso, portalUrl, geleert);
  const logosDir = join(portalDir, "logos");
  const logos = await logoDateien(logosDir, liste, neueLogos);
  const geaendert = envNeu !== envAlt || logos.length > 0 || instanzen.length > 0;
  const neustarts = await offeneNeustarts(
    k,
    portalDir,
    envNeu !== envAlt,
    logos.length > 0,
    instanzen.map((d) => d.i),
    erstmals,
  );
  await mkdir(logosDir, { recursive: true });
  await chmod(logosDir, 0o755);
  await schreiben([
    ...(envNeu !== envAlt ? [{ pfad: envPfad, inhalt: envNeu, geheim: true }] : []),
    ...logos,
    ...instanzen.map((d) => d.datei),
    offenDatei(portalDir, neustarts.offen),
  ]);
  const alle = [...mitSso.map((m) => m.i), ...ohneSso];
  const { gestartet, gestoppt, portalGestoppt } = await neuStarten(k, portalDir, neustarts.offen, neustarts.starten, neustarts.portalLaeuft, alle);

  const kurz = (e: Eintrag) => (e.logo ? "Logo" : (e.zeichen.farbe ?? "–"));
  for (const z of tabelle([["INSTANZ", "DOMAIN", "ZEICHEN"], ...liste.map((e) => [e.instanz.name, new URL(e.url).hostname, kurz(e)])])) k.aus(z);
  if (geleert.length > 0) k.aus(`HABEN_FIRMEN geleert (die Liste kommt jetzt aus dem Firmenportal): ${geleert.join(" ")}`);
  if (ohneSso.length > 0) k.aus(`Ohne SSO, nicht im Firmenportal: ${ohneSso.map((i) => i.name).join(" ")}`);
  if (gestoppt.length > 0) k.aus(`Gestoppt, nur die .env geändert: ${gestoppt.join(" ")}`);
  if (portalGestoppt) k.aus(`Das Firmenportal ist gestoppt; die Änderungen gelten nach: cd ${portalDir} && docker compose up -d`);
  k.aus(gestartet.length > 0 ? `Neu gestartet: ${gestartet.join(" ")}` : geaendert ? "Keine Neustarts nötig." : "Nichts geändert.");
}
