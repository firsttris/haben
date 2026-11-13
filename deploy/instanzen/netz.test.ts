/**
 * Eigenes Netz je Instanz zum Proxy (#872): Der Proxy hängt in allen, jede App nur in ihrem eigenen; im gemeinsamen
 * Netz erreichte jede App jede andere auf Port 3000 am Proxy vorbei. Die Netze des gemeinsamen Caddy stehen in
 * proxy/compose.override.yml, die `docker compose up -d` neben compose.yml mitliest: So übersteht die Liste einen
 * Neuaufbau des Containers, anders als `docker network connect`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const datei = (...pfad: string[]) => readFileSync(join(t.basis, ...pfad), "utf8");
/** Netznamen einer Compose-Datei, in der Reihenfolge der Datei */
const netze = (text: string) => [...text.matchAll(/^ {4}name: (\S+)$/gm)].map((m) => m[1]);

/** Stand vor #872: App im gemeinsamen Netz haben-proxy, proxy/compose.yml mit diesem einen Netz */
function altbestand() {
  const override =
    "services:\n  caddy:\n    profiles: [eigener-proxy]\n  app:\n    networks:\n      default:\n      proxy:\n        aliases: [haben-alt]\nnetworks:\n  proxy:\n    external: true\n    name: haben-proxy\n";
  const proxy =
    "name: haben-proxy\nservices:\n  caddy:\n    image: caddy:2\n    networks: [proxy]\nnetworks:\n  proxy:\n    name: haben-proxy\nvolumes:\n  caddy:\n";
  mkdirSync(join(t.basis, "alt"), { recursive: true });
  mkdirSync(join(t.basis, "proxy", "sites"), { recursive: true });
  writeFileSync(join(t.basis, "alt", "compose.yml"), "");
  writeFileSync(join(t.basis, "alt", ".env"), "COMPOSE_PROJECT_NAME=haben-alt\nDOMAIN=alt.example.de\n");
  writeFileSync(join(t.basis, "alt", "compose.override.yml"), override);
  writeFileSync(join(t.basis, "proxy", "Caddyfile"), "import sites/*.caddy\n");
  writeFileSync(join(t.basis, "proxy", "compose.yml"), proxy);
  writeFileSync(join(t.basis, "proxy", "sites", "alt.caddy"), "alt.example.de {\n\treverse_proxy haben-alt:3000\n}\n");
  t.docker.z.netze.add("haben-proxy");
  t.docker.z.caddyLaeuft = true;
  return { override, proxy };
}

describe("eigenes Netz je Instanz", () => {
  it("hängt jede App nur in ihr eigenes Netz zum Proxy, keine in ein gemeinsames", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de")).status).toBe(0);
    expect((await t.lauf("neu", "firma2", "firma2.example.de")).status).toBe(0);
    expect(netze(datei("firma1", "compose.override.yml"))).toEqual(["haben-proxy-firma1"]);
    expect(netze(datei("firma2", "compose.override.yml"))).toEqual(["haben-proxy-firma2"]);
    expect(datei("firma1", "compose.override.yml")).toContain("    external: true\n    name: haben-proxy-firma1\n");
  });

  it("hängt den gemeinsamen Caddy über proxy/compose.override.yml in die Netze aller Instanzen", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    await t.lauf("neu", "firma2", "firma2.example.de");
    const override = datei("proxy", "compose.override.yml");
    expect(override).toContain("services:\n  caddy:\n    networks: [haben-proxy-firma1, haben-proxy-firma2]\n");
    expect(override).toContain("networks:\n  haben-proxy-firma1:\n    name: haben-proxy-firma1\n  haben-proxy-firma2:\n    name: haben-proxy-firma2\n");
    // Der Caddy legt die Netze an; ein gemeinsames gibt es in einer neuen Ablage nicht mehr
    expect(override).not.toContain("external");
    expect(datei("proxy", "compose.yml")).not.toContain("networks");
  });

  it("baut den laufenden Caddy mit up -d neu auf: caddy reload hängt ihn in kein neues Netz", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de");
    t.docker.z.caddyLaeuft = true;
    await t.lauf("neu", "firma2", "firma2.example.de");
    expect(t.docker.aufrufe.filter((a) => a.startsWith("proxy compose") && !a.includes(" ps "))).toEqual(["proxy compose up -d", "proxy compose up -d"]);
  });

  it("lehnt einen Namen ab, dessen Netz es schon gibt, etwa von einer gelöschten Instanz oder einem fremden Container", async () => {
    t.docker.z.netze.add("haben-proxy-firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Das Netz haben-proxy-firma1 gibt es schon");
    expect(existsSync(join(t.basis, "firma1"))).toBe(false);
    expect(t.docker.aufrufe.some((a) => a.includes(" up "))).toBe(false);
  });

  it("legt nichts an, wenn docker nicht sagen kann, ob es das Netz gibt", async () => {
    const echt = t.docker.ausfuehren;
    t.docker.ausfuehren = async (befehl, optionen) =>
      befehl[1] === "network" ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" } : echt(befehl, optionen);
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    expect(r.stderr).toContain("docker antwortet nicht");
    expect(existsSync(join(t.basis, "firma1"))).toBe(false);
  });
});

describe("--eigener-proxy", () => {
  it("legt das Netz der Instanz an und nennt den Befehl, mit dem der vorhandene Proxy hineinkommt", async () => {
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    expect(r.status).toBe(0);
    expect(t.docker.aufrufe).toContain("- network create haben-proxy-firma1");
    expect(r.stdout).toContain("docker network connect haben-proxy-firma1 <proxy>");
    expect(r.stdout).not.toMatch(/haben-proxy(?!-firma1)/);
    expect(netze(datei("firma1", "compose.override.yml"))).toEqual(["haben-proxy-firma1"]);
  });

  it("trägt das Netz einer Instanz hinter dem eigenen Proxy nicht beim gemeinsamen Caddy ein", async () => {
    // Das Netz ist mit docker network create angelegt; der gemeinsame Caddy hat in dieser Instanz nichts zu suchen
    await t.lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    await t.lauf("neu", "firma2", "firma2.example.de");
    expect(netze(datei("proxy", "compose.override.yml"))).toEqual(["haben-proxy-firma2"]);
  });
});

describe("Instanzen im gemeinsamen Netz haben-proxy von vor #872", () => {
  it("bleiben unangetastet und am Caddy; die neue Instanz bekommt ihr eigenes Netz", async () => {
    const vorher = altbestand();
    expect((await t.lauf("neu", "firma2", "firma2.example.de")).status).toBe(0);
    // compose.yml des Proxys behält das Netz haben-proxy: Compose führt die Netzlisten beider Dateien zusammen
    expect(datei("proxy", "compose.yml")).toBe(vorher.proxy);
    expect(datei("alt", "compose.override.yml")).toBe(vorher.override);
    expect(netze(datei("proxy", "compose.override.yml"))).toEqual(["haben-proxy-firma2"]);
    expect(netze(datei("firma2", "compose.override.yml"))).toEqual(["haben-proxy-firma2"]);
  });

  it("erfasst sie in liste, status und update wie bisher", async () => {
    altbestand();
    await t.lauf("neu", "firma2", "firma2.example.de");
    expect((await t.lauf("liste")).stdout).toMatch(/^alt +alt\.example\.de /m);
    expect((await t.lauf("status")).stdout).toMatch(/^alt +alt\.example\.de +9\.9\.9 /m);
    const r = await t.lauf("update");
    expect(r.status).toBe(0);
    expect(t.docker.aufrufe).toContain("alt compose up -d");
  });

  it("stehen nach dem Umstellen von Hand (Netzname in der Override-Datei) beim nächsten neu in der Liste des Caddy", async () => {
    const vorher = altbestand();
    writeFileSync(join(t.basis, "alt", "compose.override.yml"), vorher.override.replace("name: haben-proxy\n", "name: haben-proxy-alt\n"));
    await t.lauf("neu", "firma2", "firma2.example.de");
    expect(netze(datei("proxy", "compose.override.yml"))).toEqual(["haben-proxy-alt", "haben-proxy-firma2"]);
  });
});
