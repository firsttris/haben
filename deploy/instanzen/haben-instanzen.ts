/**
 * Mehrere Instanzen von Haben nebeneinander: je Firma eine eigene Instanz mit eigener Datenbank, eigenen Belegen,
 * eigenen Schlüsseln und eigenem Backup, alle hinter einem gemeinsamen Caddy (docs/installation.md, „Mehrere Instanzen“).
 * Läuft mit Bun direkt aus dem Checkout, ohne bun install: nur node:-Module und Bun.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bunAusfuehren } from "./ausfuehren.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { liste } from "./liste.ts";
import { neu } from "./neu.ts";
import type { NeuAngaben } from "./pruefen.ts";
import { status } from "./status.ts";
import { update } from "./update.ts";

export const HILFE = `Mehrere Instanzen von Haben nebeneinander, je Firma eine (docs/installation.md, „Mehrere Instanzen“).

  bun deploy/instanzen/haben-instanzen.ts neu <name> <domain> [Optionen]   Instanz anlegen und starten
  bun deploy/instanzen/haben-instanzen.ts update     alle nacheinander sichern, aktualisieren, Stopp beim ersten Fehler
  bun deploy/instanzen/haben-instanzen.ts status     je Instanz Version, Erreichbarkeit, ERiC und letzte Sicherung
  bun deploy/instanzen/haben-instanzen.ts liste      Name, Domain und Verzeichnis

Ablage unter --basis bzw. $HABEN_INSTANZEN (Vorgabe ~/haben): je Instanz ein Verzeichnis mit compose.yml,
compose.override.yml und .env, dazu proxy/ mit dem gemeinsamen Caddy und einer Datei je Domain in proxy/sites/.
Braucht Bun, diesen Checkout und docker mit Compose 2.23 oder neuer.

Optionen für neu:
  --hersteller-id ID         ELSTER_HERSTELLER_ID setzen (sonst bleibt sie leer)
  --eric-home PFAD           von Hand entpacktes ERiC einbinden, das sich alle Instanzen teilen können
  --eigener-proxy            keinen gemeinsamen Caddy starten; Netz haben-proxy anlegen und den Block für den
                             vorhandenen Proxy ausgeben
  --sso                      ausschließlich OpenID Connect, Gruppen haben-<name>-inhaber und -steuerberatung
  --oidc-issuer URL          mit --sso: Issuer des Anmeldedienstes
  --oidc-client-id ID        mit --sso: Client-ID dieser Instanz
  --oidc-client-secret WERT  mit --sso: ursprüngliches Clientsecret (kein Hash)
  --oidc-name NAME           mit --sso: Anzeigename der Anmeldung (Vorgabe Authelia)
  --nicht-starten            nur die Dateien anlegen, nichts starten`;

const OPTIONEN = {
  basis: { type: "string" },
  help: { type: "boolean", short: "h" },
  "hersteller-id": { type: "string" },
  "eric-home": { type: "string" },
  "eigener-proxy": { type: "boolean" },
  sso: { type: "boolean" },
  "oidc-issuer": { type: "string" },
  "oidc-client-id": { type: "string" },
  "oidc-client-secret": { type: "string" },
  "oidc-name": { type: "string" },
  "nicht-starten": { type: "boolean" },
} as const;

type Werte = ReturnType<typeof parseArgs<{ options: typeof OPTIONEN; allowPositionals: true }>>["values"];

/** Meldungen von parseArgs auf Deutsch */
function argumente(args: string[]): { werte: Werte; positionen: string[] } {
  try {
    const { values, positionals } = parseArgs({ args, options: OPTIONEN, allowPositionals: true, strict: true });
    return { werte: values, positionen: positionals };
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    const option = /'(-[^' ]+)/.exec(message)?.[1] ?? "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") abbrechen(`Unbekannte Option: ${option}`);
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE")
      abbrechen(message.includes("<value>") ? `${option} braucht einen Wert.` : `${option} nimmt keinen Wert.`);
    throw error;
  }
}

function neuAngaben(werte: Werte, positionen: string[]): NeuAngaben {
  if (positionen.length !== 2) abbrechen("Aufruf: bun deploy/instanzen/haben-instanzen.ts neu <name> <domain> [Optionen]");
  const [name = "", domain = ""] = positionen;
  const issuer = werte["oidc-issuer"];
  const clientId = werte["oidc-client-id"];
  const clientSecret = werte["oidc-client-secret"];
  let sso: NeuAngaben["sso"];
  if (werte.sso) {
    if (!issuer || !clientId || !clientSecret) abbrechen("--sso braucht --oidc-issuer, --oidc-client-id und --oidc-client-secret.");
    sso = { issuer, clientId, clientSecret, anzeigename: werte["oidc-name"] ?? "Authelia" };
  } else if ([issuer, clientId, clientSecret, werte["oidc-name"]].some((w) => w !== undefined)) abbrechen("--oidc-… nur zusammen mit --sso.");
  return {
    name,
    domain,
    herstellerId: werte["hersteller-id"],
    ericHome: werte["eric-home"],
    eigenerProxy: werte["eigener-proxy"] === true,
    starten: werte["nicht-starten"] !== true,
    sso,
  };
}

export type Abhaengigkeiten = Omit<Kontext, "basis"> & { fehler: (zeile: string) => void };

/** Führt einen Aufruf aus und gibt den Exit-Code zurück; Fehler stehen als „Fehler: …“ auf fehler */
export async function main(args: string[], a: Abhaengigkeiten): Promise<number> {
  try {
    const { werte, positionen } = argumente(args);
    if (werte.help || positionen[0] === "hilfe") {
      a.aus(HILFE);
      return 0;
    }
    const [befehl, ...rest] = positionen;
    if (befehl === undefined) {
      a.fehler(HILFE);
      return 1;
    }
    const k: Kontext = { ...a, basis: resolve(werte.basis ?? a.shell.HABEN_INSTANZEN ?? resolve(a.shell.HOME ?? homedir(), "haben")) };
    if (befehl === "neu") {
      await neu(k, neuAngaben(werte, rest));
      return 0;
    }
    const befehle: Record<string, (k: Kontext) => Promise<void>> = { update, status, liste };
    const ausfuehren = befehle[befehl];
    if (!ausfuehren) abbrechen(`Unbekannter Befehl: ${befehl} (neu, update, status, liste)`);
    const nurNeu = Object.keys(werte).filter((o) => o !== "basis" && o !== "help");
    if (nurNeu.length > 0) abbrechen(`--${nurNeu[0]} gilt nur für neu.`);
    if (rest.length > 0) abbrechen(`${befehl} nimmt keine weiteren Angaben: ${rest.join(" ")}`);
    await ausfuehren(k);
    return 0;
  } catch (error) {
    a.fehler(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** HTTP-Status ohne Weiterleitungen, höchstens zehn Sekunden; null, wenn niemand antwortet */
async function abrufen(url: string): Promise<number | null> {
  try {
    return (await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) })).status;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    vorlagen: fileURLToPath(new URL("..", import.meta.url)),
    ausfuehren: bunAusfuehren,
    shell: process.env,
    abrufen,
    schlafen: (ms) => new Promise((r) => setTimeout(r, ms)),
    warten: 300,
    takt: 5,
    aus: (zeile) => console.log(zeile),
    fehler: (zeile) => console.error(zeile),
  });
}
