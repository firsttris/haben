/**
 * entfernen <name> (#1068, Folge zu #1027/#1013): nimmt nur die Proxy-Seite einer gelöschten Instanz weg, spiegelbildlich
 * zu neu. Der Caddy baut sich dabei nie neu auf: Datei in sites/ weg, Netzliste in compose.override.yml neu, `caddy
 * reload`, `docker network disconnect`, `docker network rm`. `docker compose down -v` und das Löschen des Verzeichnisses
 * macht vorher der Mensch; das Werkzeug löscht keine Daten.
 *
 * Was die Unit-Tests belegen und was nicht: Dass der Caddy-Container derselbe bleibt, zeigen hier nur der Zähler
 * caddyErzeugt der Docker-Attrappe und das Fehlen von up, restart und --force-recreate in den Aufrufen. Die Gleichheit
 * der echten Container-ID vor und nach entfernen belegt allein das CI-Skript deploy/tests/instanzen-netze.sh.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HILFE } from "./haben-instanzen.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const RELOAD = "proxy compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile";
const site = (name: string) => join(t.basis, "proxy", "sites", `${name}.caddy`);
const overrideDatei = () => join(t.basis, "proxy", "compose.override.yml");
const netze = (text: string) => [...text.matchAll(/^ {4}name: (\S+)$/gm)].map((m) => m[1]);

/** Zwei Instanzen hinter laufendem Caddy; danach löscht „der Mensch“ firma2 (down -v, Verzeichnis weg) */
async function zweiInstanzen(loeschen = "firma2") {
  expect((await t.lauf("neu", "firma1", "firma1.example.de")).status).toBe(0);
  expect((await t.lauf("neu", "firma2", "firma2.example.de")).status).toBe(0);
  rmSync(join(t.basis, loeschen), { recursive: true });
  t.docker.aufrufe.length = 0;
}

/** Stand vor #872: eine Instanz im gemeinsamen Netz haben-proxy, ohne compose.override.yml im proxy/ */
function altbestand() {
  mkdirSync(join(t.basis, "proxy", "sites"), { recursive: true });
  const proxy = "name: haben-proxy\nservices:\n  caddy:\n    image: caddy:2\n    networks: [proxy]\nnetworks:\n  proxy:\n    name: haben-proxy\n";
  writeFileSync(join(t.basis, "proxy", "Caddyfile"), "import sites/*.caddy\n");
  writeFileSync(join(t.basis, "proxy", "compose.yml"), proxy);
  writeFileSync(site("alt"), "alt.example.de {\n\treverse_proxy haben-alt:3000\n}\n");
  t.docker.z.netze.add("haben-proxy");
  t.docker.z.caddyLaeuft = true;
  t.docker.z.caddyNetze = new Set(["haben-proxy"]);
  return proxy;
}

describe("entfernen mit laufendem Caddy", () => {
  it("lässt den Container, wie er ist: dieselbe ID, kein up, restart oder --force-recreate", async () => {
    await zweiInstanzen();
    const erzeugt = t.docker.z.caddyErzeugt;
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status, r.stderr).toBe(0);
    expect(t.docker.z.caddyErzeugt).toBe(erzeugt);
    expect(t.docker.z.caddyLaeuft).toBe(true);
    expect(t.docker.aufrufe.filter((a) => a.startsWith("proxy compose") && !a.includes(" ps "))).toEqual([RELOAD]);
    expect(t.docker.aufrufe.some((a) => /\b(up|restart|down|--force-recreate)\b/.test(a))).toBe(false);
    expect(t.docker.aufrufe).toContain("proxy compose ps -q caddy");
  });

  it("geht in der Reihenfolge Datei weg, Override neu, reload, disconnect, network rm vor", async () => {
    await zweiInstanzen();
    const stand: { datei: boolean; override: string }[] = [];
    const echt = t.docker.ausfuehren;
    t.docker.ausfuehren = async (befehl, optionen) => {
      if (befehl.includes("reload")) stand.push({ datei: existsSync(site("firma2")), override: readFileSync(overrideDatei(), "utf8") });
      return echt(befehl, optionen);
    };
    expect((await t.lauf("entfernen", "firma2")).status).toBe(0);
    // Beim reload ist die Datei schon weg und die Netzliste schon ohne firma2
    expect(stand).toHaveLength(1);
    expect(stand[0]?.datei).toBe(false);
    expect(netze(stand[0]?.override ?? "")).toEqual(["haben-proxy-firma1"]);
    const a = t.docker.aufrufe;
    const [reload = -1, disconnect = -1, rm = -1] = [RELOAD, "- network disconnect haben-proxy-firma2 caddy-id", "- network rm haben-proxy-firma2"].map((x) =>
      a.indexOf(x),
    );
    expect(reload).toBeGreaterThanOrEqual(0);
    expect(disconnect).toBeGreaterThan(reload);
    expect(rm).toBeGreaterThan(disconnect);
  });

  it("lässt die anderen Instanzen und ihre Netze, wie sie sind", async () => {
    await zweiInstanzen();
    expect((await t.lauf("entfernen", "firma2")).status).toBe(0);
    expect(existsSync(site("firma1"))).toBe(true);
    expect(existsSync(site("firma2"))).toBe(false);
    expect(netze(readFileSync(overrideDatei(), "utf8"))).toEqual(["haben-proxy-firma1"]);
    expect(readFileSync(overrideDatei(), "utf8")).toContain("networks: [haben-proxy-firma1]");
    expect([...t.docker.z.caddyNetze]).toEqual(["haben-proxy-firma1"]);
    expect(t.docker.z.netze.has("haben-proxy-firma1")).toBe(true);
    expect(t.docker.z.netze.has("haben-proxy-firma2")).toBe(false);
    expect(existsSync(join(t.basis, "proxy", "compose.yml"))).toBe(true);
  });

  it("löscht die Override-Datei, wenn es die letzte Instanz war", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    rmSync(join(t.basis, "firma1"), { recursive: true });
    const r = await t.lauf("entfernen", "firma1");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(overrideDatei())).toBe(false);
    expect(existsSync(site("firma1"))).toBe(false);
    expect(t.docker.z.netze.has("haben-proxy-firma1")).toBe(false);
    expect(t.docker.z.caddyLaeuft).toBe(true);
  });

  it("sagt, was getan wurde, dass der Container unverändert blieb und was ein späteres up -d tut", async () => {
    await zweiInstanzen();
    const r = await t.lauf("entfernen", "firma2");
    expect(r.stdout).toContain("proxy/sites/firma2.caddy entfernt");
    expect(r.stdout).toContain("caddy reload");
    expect(r.stdout).toContain("Netz haben-proxy-firma2");
    expect(r.stdout).toContain("Der Caddy-Container blieb unverändert.");
    expect(r.stdout).not.toContain("durchgehend erreichbar");
    expect(r.stdout).toContain(`schlichtes \`docker compose up -d\` in ${join(t.basis, "proxy")}`);
    expect(r.stdout).toContain("einmal neu");
  });
});

describe("entfernen mit anders geschriebener Netzzeile", () => {
  it("erkennt das eigene Netz auch mit Anführungszeichen und Kommentar in der Override-Datei des Caddy", async () => {
    await zweiInstanzen();
    writeFileSync(overrideDatei(), readFileSync(overrideDatei(), "utf8").replace("name: haben-proxy-firma2", 'name: "haben-proxy-firma2"  # x'));
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status, r.stderr).toBe(0);
    expect(t.docker.aufrufe).toContain("- network disconnect haben-proxy-firma2 caddy-id");
    expect(t.docker.aufrufe).toContain("- network rm haben-proxy-firma2");
    expect(t.docker.z.netze.has("haben-proxy-firma2")).toBe(false);
  });
});

describe("entfernen mit gestopptem Caddy", () => {
  it("ändert nur Datei, Override und Netz: der Caddy bleibt gestoppt, kein reload, kein up", async () => {
    await zweiInstanzen();
    t.docker.z.caddyLaeuft = false;
    // Ein gestoppter Container hält keine Endpunkte mehr in den Netzen
    t.docker.z.caddyNetze = new Set();
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status, r.stderr).toBe(0);
    expect(t.docker.z.caddyLaeuft).toBe(false);
    expect(t.docker.aufrufe.some((a) => a.includes("reload") || a.includes(" up ") || a.includes("disconnect"))).toBe(false);
    expect(t.docker.aufrufe).toContain("- network rm haben-proxy-firma2");
    expect(existsSync(site("firma2"))).toBe(false);
    expect(netze(readFileSync(overrideDatei(), "utf8"))).toEqual(["haben-proxy-firma1"]);
    expect(t.docker.z.netze.has("haben-proxy-firma2")).toBe(false);
    expect(r.stdout).toContain("bleibt gestoppt");
  });

  it("nennt bei einem gestoppten (oder pausierten) Caddy und scheiterndem network rm auch disconnect zum Nachholen", async () => {
    await zweiInstanzen();
    t.docker.z.caddyLaeuft = false;
    const echt = t.docker.ausfuehren;
    t.docker.ausfuehren = async (befehl, optionen) =>
      befehl[1] === "network" && befehl[2] === "rm" ? { code: 1, stdout: "", stderr: "has active endpoints" } : echt(befehl, optionen);
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Das Netz haben-proxy-firma2 ließ sich nicht entfernen");
    expect(r.stderr).toContain("docker network disconnect haben-proxy-firma2");
    expect(r.stderr).toContain("docker network rm haben-proxy-firma2");
  });

  it("nimmt ein Netz, das docker nicht mehr kennt, nicht als Fehler", async () => {
    await zweiInstanzen();
    t.docker.z.caddyLaeuft = false;
    t.docker.z.caddyNetze = new Set();
    t.docker.z.netze.delete("haben-proxy-firma2");
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(site("firma2"))).toBe(false);
  });
});

describe("entfernen scheitert unterwegs", () => {
  it("bricht beim reload ab: kein disconnect, Meldung mit Logs und den Schritten zum Nachholen", async () => {
    await zweiInstanzen();
    t.docker.z.reloadKaputt = true;
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("sites/ nicht neu eingelesen");
    expect(r.stderr).toContain("behält die bisherige Konfiguration");
    expect(r.stderr).toContain(`cd ${join(t.basis, "proxy")} && docker compose logs caddy`);
    expect(r.stderr).toContain("caddy reload --config /etc/caddy/Caddyfile");
    expect(r.stderr).toContain("docker network disconnect haben-proxy-firma2");
    expect(r.stderr).toContain("docker network rm haben-proxy-firma2");
    expect(t.docker.aufrufe.some((a) => a.includes("disconnect") || a.includes("network rm"))).toBe(false);
    expect(t.docker.z.caddyNetze.has("haben-proxy-firma2")).toBe(true);
  });

  it("bricht bei disconnect ab: kein network rm, Meldung mit den Befehlen zum Nachholen", async () => {
    await zweiInstanzen();
    t.docker.z.disconnectKaputt = true;
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nicht aus dem Netz haben-proxy-firma2 lösen");
    expect(r.stderr).toContain("docker network disconnect haben-proxy-firma2");
    expect(r.stderr).toContain("docker network rm haben-proxy-firma2");
    expect(t.docker.aufrufe.some((a) => a.includes("network rm"))).toBe(false);
    expect(t.docker.aufrufe).toContain(RELOAD);
  });

  it("meldet ein Netz, das sich nicht entfernen lässt, mit dem Befehl zum Nachholen", async () => {
    await zweiInstanzen();
    const echt = t.docker.ausfuehren;
    t.docker.ausfuehren = async (befehl, optionen) =>
      befehl[1] === "network" && befehl[2] === "rm" ? { code: 1, stdout: "", stderr: "has active endpoints" } : echt(befehl, optionen);
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Das Netz haben-proxy-firma2 ließ sich nicht entfernen");
    expect(r.stderr).toContain("docker network rm haben-proxy-firma2");
    expect(existsSync(site("firma2"))).toBe(false);
  });
});

describe("entfernen ändert nichts, wenn es die Instanz noch gibt", () => {
  const unverandert = async (r: { status: number; stderr: string }) => {
    expect(r.status).toBe(1);
    expect(existsSync(site("firma2"))).toBe(true);
    expect(netze(readFileSync(overrideDatei(), "utf8"))).toEqual(["haben-proxy-firma1", "haben-proxy-firma2"]);
    expect(t.docker.aufrufe.some((a) => a.includes("reload") || a.includes("network"))).toBe(false);
  };

  it("bricht ab, solange das Verzeichnis noch als Instanz erkannt wird", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    await t.lauf("neu", "firma2", "firma2.example.de");
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("entfernen", "firma2");
    await unverandert(r);
    expect(r.stderr).toContain(join(t.basis, "firma2"));
    expect(r.stderr).toContain("docker compose down -v");
    expect(r.stderr).toContain("Verzeichnis");
    expect(r.stderr).toContain("nichts geändert");
  });

  it("bricht ab, solange das Verzeichnis noch da ist, auch ohne .env und compose.yml", async () => {
    await zweiInstanzen();
    mkdirSync(join(t.basis, "firma2"));
    const r = await t.lauf("entfernen", "firma2");
    await unverandert(r);
    expect(r.stderr).toContain(join(t.basis, "firma2"));
    expect(r.stderr).toContain("gibt es noch");
    expect(r.stderr).toContain("nichts geändert");
  });

  it("bricht ab, solange Docker das Compose-Projekt haben-<name> noch kennt", async () => {
    await zweiInstanzen();
    t.docker.z.projekte = ["haben-firma2"];
    // Verzeichnis wieder weg, Projekt (etwa mit Containern) bleibt in docker
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Compose-Projekt haben-firma2");
    expect(r.stderr).toContain("docker compose down -v");
    expect(existsSync(site("firma2"))).toBe(true);
    expect(t.docker.aufrufe.some((a) => a.includes("reload") || a.includes("network"))).toBe(false);
  });

  it("bricht ab, wenn docker nicht sagen kann, ob es das Projekt gibt", async () => {
    await zweiInstanzen();
    t.docker.z.tot = true;
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("docker antwortet nicht");
    expect(r.stderr).toContain("nichts geändert");
    expect(existsSync(site("firma2"))).toBe(true);
  });
});

describe("entfernen bei unklarem Zustand des Caddy", () => {
  it("ändert nichts, wenn docker compose in proxy/ einen Fehler meldet", async () => {
    await zweiInstanzen();
    t.docker.z.composeKaputt.add("proxy");
    const r = await t.lauf("entfernen", "firma2");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nichts geändert");
    expect(existsSync(site("firma2"))).toBe(true);
    expect(netze(readFileSync(overrideDatei(), "utf8"))).toEqual(["haben-proxy-firma1", "haben-proxy-firma2"]);
  });
});

describe("entfernen ohne Eintrag im gemeinsamen Caddy", () => {
  it("bricht ab und verweist für --eigener-proxy auf den eigenen Proxy", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    rmSync(join(t.basis, "firma1"), { recursive: true });
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("entfernen", "firma1");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Kein Eintrag");
    expect(r.stderr).toContain("im gemeinsamen Caddy");
    expect(r.stderr).toContain("--eigener-proxy");
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("bricht auch ab, wenn es proxy/ gar nicht gibt", async () => {
    const r = await t.lauf("entfernen", "firma1");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Kein Eintrag");
    expect(existsSync(join(t.basis, "proxy"))).toBe(false);
  });
});

describe("entfernen mit Instanz im alten gemeinsamen Netz haben-proxy", () => {
  it("entfernt nur die Datei und liest neu ein: kein disconnect, kein network rm", async () => {
    const proxy = altbestand();
    const r = await t.lauf("entfernen", "alt");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(site("alt"))).toBe(false);
    expect(t.docker.aufrufe.filter((a) => a.startsWith("proxy compose") && !a.includes(" ps "))).toEqual([RELOAD]);
    expect(t.docker.aufrufe.some((a) => a.includes("network"))).toBe(false);
    expect(readFileSync(join(t.basis, "proxy", "compose.yml"), "utf8")).toBe(proxy);
    expect(t.docker.z.netze.has("haben-proxy")).toBe(true);
    expect([...t.docker.z.caddyNetze]).toEqual(["haben-proxy"]);
  });

  it("gibt keinen Hinweis auf ein späteres up -d: die Netzliste hat sich nicht geändert", async () => {
    altbestand();
    const r = await t.lauf("entfernen", "alt");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Der Caddy-Container blieb unverändert.");
    expect(r.stdout).not.toContain("docker compose up -d");
  });

  it("lässt die Netze der anderen Instanzen in der Override-Datei", async () => {
    altbestand();
    expect((await t.lauf("neu", "firma2", "firma2.example.de")).status).toBe(0);
    expect((await t.lauf("entfernen", "alt")).status).toBe(0);
    expect(netze(readFileSync(overrideDatei(), "utf8"))).toEqual(["haben-proxy-firma2"]);
  });
});

describe("Aufruf von entfernen", () => {
  it("prüft den Namen wie neu, bevor es etwas anfasst", async () => {
    for (const name of ["Firma_1", "proxy", "firma-app-1", "", "..", "../firma1", "firma1/x"]) {
      const r = await t.lauf("entfernen", name);
      expect(r.status, name).toBe(1);
      expect(r.stderr, name).toMatch(/^Fehler: /);
    }
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("braucht genau einen Namen", async () => {
    const keiner = await t.lauf("entfernen");
    expect(keiner.status).toBe(1);
    expect(keiner.stderr).toContain("Aufruf: bun deploy/instanzen/haben-instanzen.ts entfernen <name>");
    const zwei = await t.lauf("entfernen", "firma1", "firma2");
    expect(zwei.status).toBe(1);
    expect(zwei.stderr).toContain("Aufruf: bun deploy/instanzen/haben-instanzen.ts entfernen <name>");
  });

  it("nimmt außer --basis und --help keine Optionen an", async () => {
    const r = await t.lauf("entfernen", "firma1", "--sso");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("Fehler: --sso gilt nur für neu.");
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("steht in der Hilfe und in der Liste der Befehle bei einem unbekannten", async () => {
    expect(HILFE).toMatch(/entfernen <name>/);
    expect(HILFE).toContain("--eigener-proxy");
    const r = await t.lauf("loeschen");
    expect(r.stderr).toContain("Unbekannter Befehl: loeschen (neu, update, status, liste, firmen, portal, entfernen)");
  });
});
