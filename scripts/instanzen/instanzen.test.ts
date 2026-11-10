/**
 * deploy/instanzen/haben-instanzen.sh mit nachgebautem docker und curl: getrennte Schlüssel und Namen je Instanz,
 * nichts Vorhandenes überschreiben, Gruppen je Instanz mit SSO, Stopp beim ersten fehlgeschlagenen Update (#504).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SKRIPT = resolve(import.meta.dirname, "../../deploy/instanzen/haben-instanzen.sh");

/**
 * docker-Ersatz: schreibt jeden Aufruf mit dem Verzeichnis nach aufrufe. Zustände als Dateien in $FAKE_STATE:
 * kaputt-<instanz> (App startet immer neu), gestoppt-<instanz>, backup-kaputt-<instanz>, caddy-laeuft, netz,
 * compose-kaputt-<instanz> (Compose bricht mit einem Fehler ab, etwa wegen einer fehlerhaften .env),
 * langsam-<instanz> (ps --services schreibt die Dienste in getrennten Schreibvorgängen).
 * exec liest wie das echte docker compose exec die Standardeingabe.
 */
const FAKE_DOCKER = `#!/bin/sh
s="$FAKE_STATE"
d="$(basename "$PWD")"
echo "$d $*" >>"$s/aufrufe"
case "$1" in
  network)
    case "$2" in
      inspect) [ -f "$s/netz" ] ;;
      create) touch "$s/netz" ;;
    esac
    exit $? ;;
  compose) shift ;;
  *) exit 2 ;;
esac
[ ! -f "$s/compose-kaputt-$d" ] || { echo "required variable RESTIC_PASSWORD is missing a value" >&2; exit 1; }
case "$1" in
  ps)
    case "$*" in
      *--services*)
        if [ "$d" = proxy ]; then [ -f "$s/caddy-laeuft" ] && echo caddy
        elif [ -f "$s/langsam-$d" ]; then printf 'app\\n'; sleep 0.3; printf 'backup\\ndb\\n'
        elif [ ! -f "$s/gestoppt-$d" ]; then printf 'db\\napp\\nbackup\\n'; fi ;;
      *) if [ -f "$s/kaputt-$d" ]; then echo "restarting "; else echo "running healthy"; fi ;;
    esac ;;
  exec)
    cat >/dev/null
    case "$*" in
      *backup.sh*) [ ! -f "$s/backup-kaputt-$d" ] || exit 1 ;;
      *bun\\ -e*) echo 9.9.9 ;;
      *psql*) echo "2026-11-10 03:15" ;;
      *sh\\ -c*) echo 44.3.6.0 ;;
    esac ;;
  logs) echo "app-1  | Haben ist noch nicht eingerichtet. Einrichtungscode für https://x/setup: abcd-efgh" ;;
  ls) [ ! -f "$s/projekte" ] || cat "$s/projekte" ;;
  up|pull) ;;
  *) exit 2 ;;
esac
`;

const FAKE_CURL = `#!/bin/sh
printf 200
`;

let dir: string;
let basis: string;

function lauf(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [SKRIPT, "--basis", basis, ...args], {
    env: {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`,
      HOME: dir,
      FAKE_STATE: dir,
      HABEN_INSTANZEN_TAKT: "0",
      HABEN_INSTANZEN_WARTEN: "3",
    },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function env(name: string): Record<string, string> {
  const werte: Record<string, string> = {};
  for (const zeile of readFileSync(join(basis, name, ".env"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(zeile);
    if (m?.[1]) werte[m[1]] = m[2] ?? "";
  }
  return werte;
}

function aufrufe(): string[] {
  return existsSync(join(dir, "aufrufe")) ? readFileSync(join(dir, "aufrufe"), "utf8").trim().split("\n") : [];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "haben-instanzen-"));
  basis = join(dir, "haben");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "docker"), FAKE_DOCKER);
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "docker"), 0o755);
  chmodSync(join(dir, "bin", "curl"), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("neu", () => {
  it("gibt jeder Instanz eigene Schlüssel, Projektnamen und Backup-Namen", () => {
    expect(lauf("neu", "firma1", "firma1.example.de").status).toBe(0);
    expect(lauf("neu", "firma2", "firma2.example.de").status).toBe(0);
    const [a, b] = [env("firma1"), env("firma2")];
    for (const key of ["DB_PASSWORD", "AUTH_SECRET", "ENCRYPTION_KEY", "RESTIC_PASSWORD"]) {
      expect(a[key], key).toMatch(/^[A-Za-z0-9+/=]{32,}$/);
      expect(a[key], key).not.toBe(b[key]);
    }
    expect(a.DB_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
    expect([a.COMPOSE_PROJECT_NAME, b.COMPOSE_PROJECT_NAME]).toEqual(["haben-firma1", "haben-firma2"]);
    expect([a.BACKUP_HOST, b.BACKUP_HOST]).toEqual(["haben-firma1", "haben-firma2"]);
    expect([a.DOMAIN, b.DOMAIN]).toEqual(["firma1.example.de", "firma2.example.de"]);
    expect(statSync(join(basis, "firma1", ".env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(basis, "firma2", "compose.override.yml"), "utf8")).toContain("aliases: [haben-firma2]");
    expect(readFileSync(join(basis, "proxy", "sites", "firma2.caddy"), "utf8")).toMatch(/^firma2\.example\.de \{[\s\S]*reverse_proxy haben-firma2:3000/);
    // compose.yml unverändert aus deploy/
    expect(readFileSync(join(basis, "firma1", "compose.yml"), "utf8")).toBe(readFileSync(resolve(SKRIPT, "../../compose.yml"), "utf8"));
  });

  it("startet den Proxy vor der Instanz, lädt ihn danach nur neu und nennt den Einrichtungscode", () => {
    const erste = lauf("neu", "firma1", "firma1.example.de");
    expect(erste.stdout).toContain("Einrichtungscode für https://x/setup: abcd-efgh");
    expect(aufrufe().filter((a) => a.includes(" up -d"))).toEqual(["proxy compose up -d", "firma1 compose up -d"]);
    writeFileSync(join(dir, "caddy-laeuft"), "");
    lauf("neu", "firma2", "firma2.example.de");
    expect(aufrufe()).toContain("proxy compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile");
  });

  it("lässt ein vorhandenes Verzeichnis samt .env unangetastet", () => {
    mkdirSync(join(basis, "firma1"), { recursive: true });
    writeFileSync(join(basis, "firma1", ".env"), "ENCRYPTION_KEY=alt\n");
    const r = lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("gibt es schon");
    expect(readFileSync(join(basis, "firma1", ".env"), "utf8")).toBe("ENCRYPTION_KEY=alt\n");
    expect(aufrufe()).toEqual([]);
  });

  it("lehnt eine Domain ab, die schon einer Instanz gehört", () => {
    lauf("neu", "firma1", "firma1.example.de");
    const r = lauf("neu", "firma2", "firma1.example.de");
    expect(r.stderr).toContain("gehört schon zur Instanz firma1");
    expect(existsSync(join(basis, "firma2"))).toBe(false);
  });

  it.each([
    ["Firma1", "firma1.example.de"],
    ["-x", "firma1.example.de"],
    ["proxy", "proxy.example.de"],
    ["a/b", "firma1.example.de"],
    ["firma1", "https://firma1.example.de"],
    ["firma1", "firma1.example.de/haben"],
    ["firma1", "localhost"],
  ])("lehnt Name %s mit Domain %s ab", (name, domain) => {
    expect(lauf("neu", name, domain).status).not.toBe(0);
    expect(existsSync(join(basis, name))).toBe(false);
    expect(aufrufe()).toEqual([]);
  });

  it("setzt die Hersteller-ID nur auf ausdrückliche Angabe", () => {
    lauf("neu", "firma1", "firma1.example.de");
    lauf("neu", "firma2", "firma2.example.de", "--hersteller-id", "12345");
    expect(env("firma1").ELSTER_HERSTELLER_ID).toBe("");
    expect(env("firma2").ELSTER_HERSTELLER_ID).toBe("12345");
  });

  it("vergibt mit SSO eindeutige Gruppen je Instanz und übernimmt das Secret wörtlich", () => {
    const sso = (name: string) => ["--sso", "--oidc-issuer", "https://auth.example.de", "--oidc-client-id", `haben-${name}`, "--oidc-client-secret", "ge$heim"];
    expect(lauf("neu", "firma1", "firma1.example.de", ...sso("firma1")).status).toBe(0);
    expect(lauf("neu", "firma2", "firma2.example.de", ...sso("firma2")).status).toBe(0);
    const [a, b] = [env("firma1"), env("firma2")];
    expect(a.OIDC_ONLY).toBe("true");
    expect([a.OIDC_GROUP_INHABER, a.OIDC_GROUP_STEUERBERATUNG]).toEqual(["haben-firma1-inhaber", "haben-firma1-steuerberatung"]);
    expect([b.OIDC_GROUP_INHABER, b.OIDC_GROUP_STEUERBERATUNG]).toEqual(["haben-firma2-inhaber", "haben-firma2-steuerberatung"]);
    // In einfachen Anführungszeichen ersetzt Compose kein $
    expect(a.OIDC_CLIENT_SECRET).toBe("'ge$heim'");
    expect(env("firma1").OIDC_ISSUER).toBe("'https://auth.example.de'");
  });

  it("verlangt für SSO alle Angaben und nimmt sie nicht ohne --sso", () => {
    expect(lauf("neu", "firma1", "firma1.example.de", "--sso", "--oidc-issuer", "https://auth.example.de").stderr).toContain("--sso braucht");
    expect(lauf("neu", "firma1", "firma1.example.de", "--oidc-client-id", "x").stderr).toContain("nur zusammen mit --sso");
    expect(
      lauf("neu", "firma1", "firma1.example.de", "--sso", "--oidc-issuer", "https://a.de", "--oidc-client-id", "x", "--oidc-client-secret", "it's").stderr,
    ).toContain("darf weder");
    expect(existsSync(join(basis, "firma1"))).toBe(false);
  });

  it("legt mit --eigener-proxy nur das Netz an und gibt den Block aus", () => {
    const r = lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("reverse_proxy haben-firma1:3000");
    expect(existsSync(join(basis, "proxy"))).toBe(false);
    expect(aufrufe().some((a) => a.endsWith(" network create haben-proxy"))).toBe(true);
  });

  it("bindet mit --eric-home ein gemeinsames ERiC lesend ein", () => {
    lauf("neu", "firma1", "firma1.example.de", "--eric-home", "/opt/eric", "--nicht-starten");
    expect(env("firma1").ERIC_HOME).toBe("/opt/eric");
    expect(readFileSync(join(basis, "firma1", "compose.override.yml"), "utf8")).toContain("- /opt/eric:/opt/eric:ro");
    // Nur nachgesehen, welche Projekte es gibt; nichts gestartet
    expect(aufrufe().map((a) => a.replace(/^\S+ /, ""))).toEqual(["compose ls -a -q", "volume ls -q --filter label=com.docker.compose.project=haben-firma1"]);
  });

  it("meldet eine App, die nicht gesund wird", () => {
    writeFileSync(join(dir, "kaputt-firma1"), "");
    const r = lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Die App von firma1 ist nicht gesund geworden");
  });
});

describe("update", () => {
  beforeEach(() => {
    for (const n of ["firma1", "firma2", "firma3"]) lauf("neu", n, `${n}.example.de`, "--nicht-starten");
  });

  it("sichert und aktualisiert alle der Reihe nach", () => {
    const r = lauf("update");
    expect(r.status).toBe(0);
    const schritte = aufrufe().filter((a) => /backup\.sh| pull| up -d/.test(a));
    expect(schritte).toEqual(
      ["firma1", "firma2", "firma3"].flatMap((n) => [`${n} compose exec -T backup backup.sh`, `${n} compose pull`, `${n} compose up -d`]),
    );
  });

  it("stoppt bei der ersten fehlgeschlagenen Instanz und nennt sie", () => {
    writeFileSync(join(dir, "kaputt-firma2"), "");
    const r = lauf("update");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2: Die App ist nach dem Update nicht gesund");
    expect(aufrufe().some((a) => a.startsWith("firma3 "))).toBe(false);
  });

  it("stoppt, wenn die Sicherung vorher fehlschlägt, ohne zu aktualisieren", () => {
    writeFileSync(join(dir, "backup-kaputt-firma1"), "");
    const r = lauf("update");
    expect(r.stderr).toContain("firma1: Sicherung vor dem Update fehlgeschlagen");
    expect(aufrufe().filter((a) => / pull| up -d/.test(a))).toEqual([]);
  });

  it("überspringt eine gestoppte Instanz und nennt sie am Ende", () => {
    writeFileSync(join(dir, "gestoppt-firma2"), "");
    const r = lauf("update");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Nicht aktualisiert, weil gestoppt: firma2");
    expect(aufrufe()).toContain("firma3 compose up -d");
    expect(aufrufe().some((a) => a.startsWith("firma2 compose pull"))).toBe(false);
  });
});

describe("status und liste", () => {
  it("zeigt je Instanz Version, Erreichbarkeit, ERiC und Sicherung und meldet eine gestoppte", () => {
    lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    lauf("neu", "firma2", "firma2.example.de", "--nicht-starten");
    writeFileSync(join(dir, "gestoppt-firma2"), "");
    const r = lauf("status");
    expect(r.status).toBe(0);
    const zeilen = r.stdout.trim().split("\n");
    expect(zeilen[1]).toMatch(/^firma1\s+firma1\.example\.de\s+9\.9\.9\s+ja\s+44\.3\.6\.0\s+2026-11-10 03:15$/);
    expect(zeilen[2]).toMatch(/^firma2\s+firma2\.example\.de\s+gestoppt\s+ja\s+–\s+– \(Datenbank gestoppt\)$/);
  });

  it("findet auch Instanzen, die nach der Doku von Hand angelegt sind, und nichts anderes", () => {
    mkdirSync(join(basis, "haben-alt"), { recursive: true });
    writeFileSync(join(basis, "haben-alt", "compose.yml"), "");
    writeFileSync(join(basis, "haben-alt", ".env"), "COMPOSE_PROJECT_NAME=haben-alt\nDOMAIN=alt.example.de\n");
    mkdirSync(join(basis, "fremd"), { recursive: true });
    writeFileSync(join(basis, "fremd", "compose.yml"), "");
    writeFileSync(join(basis, "fremd", ".env"), "COMPOSE_PROJECT_NAME=etwas\n");
    lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    const namen = lauf("liste")
      .stdout.trim()
      .split("\n")
      .map((z) => z.split(/\s+/)[0]);
    expect(namen).toEqual(["firma1", "haben-alt"]);
  });
});

describe("Review", () => {
  it("lehnt einen Namen ab, dessen Compose-Projekt docker schon kennt", () => {
    writeFileSync(join(dir, "projekte"), "haben\nhaben-firma1\n");
    const r = lauf("neu", "firma1", "firma1.example.de");
    expect(r.stderr).toContain("Docker kennt schon ein Compose-Projekt haben-firma1");
    expect(existsSync(join(basis, "firma1"))).toBe(false);
    expect(aufrufe().some((a) => a.includes(" up "))).toBe(false);
  });

  it("lehnt einen Namen ab, dessen Projekt und Alias schon eine von Hand angelegte Instanz trägt", () => {
    // Von Hand nach der Doku: Verzeichnis haben-firma1, COMPOSE_PROJECT_NAME=haben-firma1, Alias haben-firma1
    mkdirSync(join(basis, "haben-firma1"), { recursive: true });
    writeFileSync(join(basis, "haben-firma1", "compose.yml"), "");
    writeFileSync(join(basis, "haben-firma1", ".env"), "COMPOSE_PROJECT_NAME=haben-firma1\nDOMAIN=alt.example.de\n");
    const r = lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1"))).toBe(false);
    expect(aufrufe().some((a) => a.startsWith("firma1 compose up"))).toBe(false);
  });

  it("hält beim Update an, wenn Compose für eine Instanz einen Fehler meldet, statt sie als gestoppt zu überspringen", () => {
    for (const n of ["firma1", "firma2", "firma3"]) lauf("neu", n, `${n}.example.de`, "--nicht-starten");
    writeFileSync(join(dir, "compose-kaputt-firma2"), "");
    const r = lauf("update");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2");
    expect(aufrufe().some((a) => a.startsWith("firma3 compose pull"))).toBe(false);
  });

  it("zeigt im Status eine Instanz, bei der Compose einen Fehler meldet, als Fehler statt gestoppt", () => {
    lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    writeFileSync(join(dir, "compose-kaputt-firma1"), "");
    const r = lauf("status");
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")[1]).toMatch(/^firma1\s+firma1\.example\.de\s+Fehler\s/);
  });

  it("erkennt eine laufende App auch, wenn docker die Dienste einzeln ausgibt (pipefail und grep -q)", () => {
    lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    writeFileSync(join(dir, "langsam-firma1"), "");
    const r = lauf("status");
    expect(r.stdout.trim().split("\n")[1]).toMatch(/^firma1\s+firma1\.example\.de\s+9\.9\.9\s/);
  });

  it("erkennt die Domain einer von Hand angelegten Instanz auch in doppelten Anführungszeichen", () => {
    mkdirSync(join(basis, "haben-alt"), { recursive: true });
    writeFileSync(join(basis, "haben-alt", "compose.yml"), "");
    writeFileSync(join(basis, "haben-alt", ".env"), 'COMPOSE_PROJECT_NAME=haben-alt\nDOMAIN="alt.example.de"\n');
    const r = lauf("neu", "firma1", "alt.example.de", "--nicht-starten");
    expect(r.stderr).toContain("gehört schon zur Instanz haben-alt");
    expect(existsSync(join(basis, "firma1"))).toBe(false);
  });
});

describe("Review, Zusatzrunde", () => {
  it("lehnt einen Namen ab, dessen Projekt nur noch als Volumes besteht (nach docker compose down)", () => {
    // Von Hand angelegte Instanz außerhalb der Basis nach docker compose down: keine Container, also nicht in
    // compose ls -a, aber die Volumes mit Datenbank und Belegen der Firma sind noch da
    writeFileSync(join(dir, "volumen"), "haben-firma1_db\nhaben-firma1_belege\nhaben-firma1_backups\n");
    writeFileSync(join(dir, "bin", "docker-fake"), FAKE_DOCKER);
    chmodSync(join(dir, "bin", "docker-fake"), 0o755);
    writeFileSync(
      join(dir, "bin", "docker"),
      `#!/bin/sh\nif [ "$1" = volume ]; then echo "$(basename "$PWD") $*" >>"$FAKE_STATE/aufrufe"; cat "$FAKE_STATE/volumen"; exit 0; fi\nexec "$(dirname "$0")/docker-fake" "$@"\n`,
    );
    const r = lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1"))).toBe(false);
    expect(aufrufe().some((a) => a.startsWith("firma1 compose up"))).toBe(false);
  });

  it("vergibt keinen Alias, der im Netz haben-proxy schon der Containername einer anderen Instanz ist", () => {
    // Die App von firma1 heißt im Netz haben-proxy auch haben-firma1-app-1; der Alias von firma1-app-1 wäre derselbe
    expect(lauf("neu", "firma1", "firma1.example.de", "--nicht-starten").status).toBe(0);
    const r = lauf("neu", "firma1-app-1", "x.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1-app-1"))).toBe(false);
  });

  it("lehnt einen Namen mit - am Ende ab (haben-firma1- ist kein gültiger Hostname für reverse_proxy)", () => {
    const r = lauf("neu", "firma1-", "firma1.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1-"))).toBe(false);
  });

  it("meldet im Status bei einem Compose-Fehler die Datenbank nicht als gestoppt", () => {
    lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    writeFileSync(join(dir, "compose-kaputt-firma1"), "");
    const zeile = lauf("status").stdout.trim().split("\n")[1];
    expect(zeile).toMatch(/\sFehler\s/);
    expect(zeile).not.toContain("Datenbank gestoppt");
  });

  it("erkennt das Projekt einer von Hand angelegten Instanz auch mit Kommentar am Zeilenende", () => {
    // Compose liest COMPOSE_PROJECT_NAME=haben-firma1 # Firma 1 als haben-firma1
    mkdirSync(join(basis, "haben-firma1"), { recursive: true });
    writeFileSync(join(basis, "haben-firma1", "compose.yml"), "");
    writeFileSync(join(basis, "haben-firma1", ".env"), "COMPOSE_PROJECT_NAME=haben-firma1 # Firma 1\nDOMAIN=alt.example.de\n");
    const r = lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1"))).toBe(false);
  });
});

describe("Review, dritte Runde", () => {
  it("vergibt keinen Alias, der dem Containernamen des Standardprojekts haben gleicht (app-1 → haben-app-1)", () => {
    // compose.yml heißt ohne COMPOSE_PROJECT_NAME haben (name: haben); deren App heißt haben-app-1 und hängt mit der
    // Override-Datei aus der Doku im Netz des Proxys. Die Regel gegen -app-1 am Ende greift ohne - davor nicht
    const r = lauf("neu", "app-1", "x.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "app-1"))).toBe(false);
  });

  it("vergibt nicht den Alias haben-app, den eine einzelne Instanz nach compose.override.example.yml trägt", () => {
    const r = lauf("neu", "app", "x.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "app"))).toBe(false);
  });

  it("legt keine Instanz an, wenn docker nicht sagen kann, ob es Volumes des Projekts schon gibt", () => {
    // Etwa ohne Rechte am Docker-Socket oder bei gestopptem Daemon: beide Prüfungen fallen still weg, das Verzeichnis
    // entsteht, und ein späteres docker compose up -d übernimmt übrig gebliebene Volumes haben-firma1_db usw.
    writeFileSync(
      join(dir, "bin", "docker"),
      `#!/bin/sh\necho "$(basename "$PWD") $*" >>"$FAKE_STATE/aufrufe"\necho "permission denied while trying to connect to the Docker daemon socket" >&2\nexit 1\n`,
    );
    const r = lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(existsSync(join(basis, "firma1"))).toBe(false);
  });
});
