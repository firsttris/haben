/**
 * Nachgebautes docker für die Tests des Werkzeugs, als Ausfuehren. Jeder Aufruf steht in `aufrufe` als
 * „<Verzeichnis> <Argumente ohne docker>“ (Verzeichnis „-“ für Aufrufe ohne Projekt), seine Umgebung in `umgebungen`.
 * Zustände je Instanz (Name des Verzeichnisses) in `z`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Ausfuehren, Ergebnis } from "./ausfuehren.ts";
import { type Abhaengigkeiten, main } from "./haben-instanzen.ts";

export const VORLAGEN = resolve(import.meta.dirname, "..");

export interface Zustaende {
  /** Die App startet nach `up -d` ständig neu (etwa eine fehlgeschlagene Migration) */
  kaputt: Set<string>;
  /** Die App startet schon vorher ständig neu */
  schleife: Set<string>;
  gestoppt: Set<string>;
  backupKaputt: Set<string>;
  /** Compose bricht mit einem Fehler ab, etwa wegen einer fehlerhaften .env */
  composeKaputt: Set<string>;
  /** Image ohne den Befehl haben */
  zuAlt: Set<string>;
  /** Der gemeinsame Caddy läuft; `up -d` in proxy/ startet ihn */
  caddyLaeuft: boolean;
  /** Netze, in denen der Container des Caddy hängt: aus den Dateien beim Neuaufbau, dazu per network connect */
  caddyNetze: Set<string>;
  /** docker network connect scheitert */
  connectKaputt: boolean;
  /** caddy reload scheitert, etwa an einem fehlerhaften Block in sites/ */
  reloadKaputt: boolean;
  /** Netze, die docker kennt (docker network create, oder von Compose angelegt) */
  netze: Set<string>;
  projekte: string[];
  volumen: string[];
  /** docker erreicht den Daemon nicht */
  tot: boolean;
  /** createuser scheitert, etwa weil es die Rolle schon gibt */
  rolleKaputt: Set<string>;
  /** `up -d` bricht ab, etwa weil sich ein Image nicht laden lässt */
  upKaputt: Set<string>;
  /** Die Datenbank startet nicht, etwa weil sich ihr Image nicht laden lässt */
  dbKaputt: Set<string>;
  /** Feld zeichen in `haben status --json` je Instanz (#1036); ohne Eintrag fehlt es, wie in einem älteren Image */
  zeichen: Map<string, unknown>;
  /** Was `haben kennzeichen` je Instanz ausgibt; ohne Eintrag Exit-Code 3 (kein Logo als Zeichen) */
  logos: Map<string, Uint8Array>;
}

export const STATUS_JSON = JSON.stringify({
  version: "9.9.9",
  summary: { eric: "44.3.6.0", backup: "2026-11-10 03:15", speicher: "Datenbank 45,2 MB, Belege 1,3 GB" },
});

/** Die Netze in compose.override.yml eines Verzeichnisses, wie das Werkzeug sie für den Caddy schreibt */
function netzeAus(dir: string): string[] {
  const datei = join(dir, "compose.override.yml");
  return existsSync(datei) ? [...readFileSync(datei, "utf8").matchAll(/^ {4}name: (\S+)$/gm)].map((m) => m[1] ?? "") : [];
}

const ok = (stdout = ""): Ergebnis => ({ code: 0, stdout, stderr: "" });
const ps = (dienste: [string, string, string][]) => dienste.map(([Service, State, Health]) => JSON.stringify({ Service, State, Health })).join("\n");

/** Die Befehle im Container der App (haben status, haben kennzeichen) und der Neustart des Firmenportals */
function habenBefehl(z: Zustaende, d: string, sub: string, binaer?: boolean): Ergebnis | undefined {
  if (sub === "exec -T app haben status --json")
    return z.zuAlt.has(d)
      ? {
          code: 127,
          stdout: "",
          stderr: 'OCI runtime exec failed: exec failed: unable to start container process: exec: "haben": executable file not found in $PATH',
        }
      : ok(z.zeichen.has(d) ? JSON.stringify({ ...JSON.parse(STATUS_JSON), zeichen: z.zeichen.get(d) }) : STATUS_JSON);
  if (sub === "exec -T app haben kennzeichen") {
    if (!binaer) return { code: 2, stdout: "", stderr: "kennzeichen nur als Bytes lesen" };
    if (z.zuAlt.has(d)) return { code: 127, stdout: "", stderr: "executable file not found", daten: new Uint8Array() };
    const logo = z.logos.get(d);
    return logo ? { code: 0, stdout: "", stderr: "", daten: logo } : { code: 3, stdout: "", stderr: "Kein Logo als Zeichen gewählt", daten: new Uint8Array() };
  }
  if (sub === "restart firmenportal") return ok();
  return undefined;
}

/** docker network …: Netze, die docker kennt, und die des Caddy-Containers */
function netzBefehl(z: Zustaende, args: string[]): Ergebnis | undefined {
  if (args[0] === "connect") {
    if (z.connectKaputt || args[2] !== "caddy-id") return { code: 1, stdout: "", stderr: "Error response from daemon: network not found" };
    z.caddyNetze.add(args[1] ?? "");
    return ok();
  }
  const netz = args.at(-1) ?? "";
  if (args[0] === "inspect") return { code: z.netze.has(netz) ? 0 : 1, stdout: "", stderr: "" };
  if (args[0] === "create") {
    z.netze.add(netz);
    return ok();
  }
  if (args[0] === "ls") return ok([...z.netze].join("\n"));
  return undefined;
}

/** docker compose im Verzeichnis proxy/ des gemeinsamen Caddy; undefined für alles, was dort wie überall antwortet */
function caddy(z: Zustaende, sub: string, cwd: string): Ergebnis | undefined {
  if (sub === "ps -a --format json") return ok(z.caddyLaeuft ? ps([["caddy", "running", ""]]) : "");
  if (sub === "ps -q caddy") return ok(z.caddyLaeuft ? "caddy-id\n" : "");
  if (sub === "exec -T caddy caddy reload --config /etc/caddy/Caddyfile")
    return z.reloadKaputt ? { code: 1, stdout: "", stderr: "Error: adapting config using caddyfile" } : ok();
  // Compose legt fehlende Netze aus den Dateien an; --no-recreate lässt den laufenden Container, wie er ist
  if (sub === "up -d --no-recreate") {
    for (const netz of netzeAus(cwd)) z.netze.add(netz);
    return ok();
  }
  // Neuaufbau aus den Dateien: Der Container hängt danach in genau den Netzen aus compose.override.yml
  if (sub === "up -d") {
    z.caddyNetze = new Set(netzeAus(cwd));
    for (const netz of z.caddyNetze) z.netze.add(netz);
    z.caddyLaeuft = true;
    return ok();
  }
  return undefined;
}

export function nachbau() {
  const z: Zustaende = {
    kaputt: new Set(),
    schleife: new Set(),
    gestoppt: new Set(),
    backupKaputt: new Set(),
    composeKaputt: new Set(),
    zuAlt: new Set(),
    caddyLaeuft: false,
    caddyNetze: new Set(),
    connectKaputt: false,
    reloadKaputt: false,
    netze: new Set(),
    projekte: [],
    volumen: [],
    tot: false,
    rolleKaputt: new Set(),
    dbKaputt: new Set(),
    upKaputt: new Set(),
    zeichen: new Map(),
    logos: new Map(),
  };
  const aufrufe: string[] = [];
  const umgebungen: { aufruf: string; env: Record<string, string> }[] = [];
  /** Was ein Aufruf auf der Standardeingabe bekam, etwa createuser das Passwort */
  const eingaben: { aufruf: string; eingabe: string }[] = [];
  const neugestartet = new Set<string>();
  const hochgefahren = new Set<string>();

  const ausfuehren: Ausfuehren = async (befehl, { cwd, env, eingabe, binaer }) => {
    const [programm, ...args] = befehl;
    const d = basename(cwd) || "-";
    const aufruf = `${d} ${args.join(" ")}`;
    aufrufe.push(aufruf);
    umgebungen.push({ aufruf, env });
    if (eingabe !== undefined) eingaben.push({ aufruf, eingabe });
    if (programm !== "docker") return { code: 127, stdout: "", stderr: `${programm}: not found` };
    if (z.tot) return { code: 1, stdout: "", stderr: "permission denied while trying to connect to the Docker daemon socket" };
    if (args[0] === "volume") return ok(z.volumen.join("\n"));
    const n = args[0] === "network" ? netzBefehl(z, args.slice(1)) : undefined;
    if (n) return n;
    if (args[0] !== "compose") return { code: 2, stdout: "", stderr: "unbekannt" };
    if (z.composeKaputt.has(d)) return { code: 1, stdout: "", stderr: "required variable RESTIC_PASSWORD is missing a value" };
    const sub = args.slice(1).join(" ");
    const proxy = d === "proxy" ? caddy(z, sub, cwd) : undefined;
    if (proxy) return proxy;
    if (sub === "ps -a --format json") {
      // Den Container gibt es erst nach dem ersten up -d
      if (d === "firmenportal") {
        if (!hochgefahren.has(d)) return ok("");
        return ok(ps([z.gestoppt.has(d) ? ["firmenportal", "exited", ""] : ["firmenportal", "running", "healthy"]]));
      }
      if (z.gestoppt.has(d))
        return ok(
          ps([
            ["app", "exited", ""],
            ["db", "exited", ""],
          ]),
        );
      const neustart = z.schleife.has(d) || neugestartet.has(d);
      return ok(
        ps([
          ["app", neustart ? "restarting" : "running", neustart ? "" : "healthy"],
          ["db", "running", "healthy"],
          ["backup", "running", "healthy"],
        ]),
      );
    }
    if (sub === "exec -T backup backup.sh") return { code: z.backupKaputt.has(d) ? 1 : 0, stdout: "", stderr: "" };
    const haben = habenBefehl(z, d, sub, binaer);
    if (haben) return haben;
    if (sub === "logs app") return ok("app-1  | Haben ist noch nicht eingerichtet. Einrichtungscode für https://x/setup: abcd-efgh\n");
    if (sub === "ls -a -q") return ok(z.projekte.join("\n"));
    if (sub === "up -d --wait db") return { code: z.dbKaputt.has(d) ? 1 : 0, stdout: "", stderr: "" };
    if (sub.startsWith("exec -T db createuser ")) return { code: z.rolleKaputt.has(d) ? 1 : 0, stdout: "", stderr: "" };
    if (sub === "up -d") {
      if (z.upKaputt.has(d)) return { code: 1, stdout: "", stderr: "pull access denied" };
      hochgefahren.add(d);
      if (z.kaputt.has(d)) neugestartet.add(d);
      return ok();
    }
    if (sub === "pull") return ok();
    return { code: 2, stdout: "", stderr: `unbekannt: ${sub}` };
  };
  return { z, aufrufe, umgebungen, eingaben, ausfuehren };
}

/** Ein Testlauf: eigenes Verzeichnis, nachgebautes docker, Ausgaben eingesammelt */
export function umgebung() {
  const dir = mkdtempSync(join(tmpdir(), "haben-instanzen-"));
  const basis = join(dir, "haben");
  const docker = nachbau();
  let shell: Record<string, string> = { PATH: "/usr/bin:/bin", HOME: dir };
  let eingabe: string | (() => string) | null = null;
  async function lauf(...args: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const a: Abhaengigkeiten = {
      vorlagen: VORLAGEN,
      ausfuehren: docker.ausfuehren,
      shell,
      abrufen: async () => 200,
      schlafen: async () => {},
      warten: 3,
      takt: 0,
      aus: (z) => stdout.push(z),
      fehler: (z) => stderr.push(z),
      eingabe: () => {
        if (eingabe === null) throw new Error("keine Standardeingabe");
        return typeof eingabe === "string" ? eingabe : eingabe();
      },
    };
    const status = await main(["--basis", basis, ...args], a);
    return { status, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  }
  return {
    dir,
    basis,
    docker,
    lauf,
    /** Was auf der Standardeingabe ankommt, oder was beim Lesen passiert */
    eingabe: (text: string | (() => string)) => {
      eingabe = text;
    },
    /** Zusätzliche Variablen in der Shell der Person */
    shell: (extra: Record<string, string>) => {
      shell = { ...shell, ...extra };
    },
    aufraeumen: () => rmSync(dir, { recursive: true, force: true }),
  };
}
