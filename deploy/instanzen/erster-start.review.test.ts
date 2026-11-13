/**
 * Review #548, nach den getrennten Datenbankrollen (#816): Seit die App-Rolle vor dem ersten Start der App angelegt
 * sein muss, reicht `docker compose up -d` im Verzeichnis der Instanz nicht mehr, um einen Start nachzuholen. `neu`
 * lässt sich für dieselbe Instanz nicht wiederholen (das Verzeichnis gibt es dann schon); wer nachholt, braucht die
 * Schritte vom Werkzeug, in der Reihenfolge, in der es sie selbst ausführt: Proxy bzw. Netz, Datenbank, Rolle, App.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const DB = "docker compose up -d --wait db";
const CREATEUSER = "docker compose exec db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app";

/** Die Stellen der Schritte in der Ausgabe, aufsteigend, wenn alle da sind und die Reihenfolge stimmt */
function reihenfolge(text: string, schritte: string[]): void {
  const stellen = schritte.map((s) => text.indexOf(s));
  expect(stellen, text).not.toContain(-1);
  expect(stellen).toEqual([...stellen].sort((a, b) => a - b));
}

describe("abgebrochener Start, bevor es die App-Rolle gibt", () => {
  it("nennt die Schritte zum Nachholen, wenn die Datenbank nicht startet", async () => {
    t.docker.z.dbKaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    expect(t.docker.aufrufe).not.toContain("firma1 compose up -d");
    reihenfolge(r.stderr, [`cd ${t.basis}/firma1 && ${DB}`, CREATEUSER]);
    expect(r.stderr.trimEnd().endsWith("docker compose up -d")).toBe(true);
  });

  it("nennt sie auch, wenn sich die Rolle nicht anlegen lässt", async () => {
    t.docker.z.rolleKaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    reihenfolge(r.stderr, [CREATEUSER]);
    expect(r.stderr.trimEnd().endsWith("docker compose up -d")).toBe(true);
  });

  it("nennt sie auch, wenn der gemeinsame Caddy nicht startet", async () => {
    t.docker.z.composeKaputt.add("proxy");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    expect(t.docker.aufrufe).not.toContain("firma1 compose up -d");
    reihenfolge(r.stderr, [`cd ${t.basis}/proxy && docker compose up -d`, `cd ${t.basis}/firma1 && ${DB}`, CREATEUSER]);
  });

  it("nennt createuser nicht noch einmal, wenn es die Rolle schon gibt und erst die App nicht gesund wird", async () => {
    t.docker.z.kaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("createuser");
  });
});

describe("--nicht-starten", () => {
  it("nennt vor Datenbank, Rolle und App den gemeinsamen Caddy: Ohne ihn fehlt das Netz haben-proxy-firma1, und er kennt die neue Domain nicht", async () => {
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    expect(r.status).toBe(0);
    expect(t.docker.aufrufe.filter((a) => a.includes(" up ") || a.includes("network create"))).toEqual([]);
    // up -d baut den Caddy mit dem Netz der Instanz neu auf und liest dabei sites/ ein; ein caddy reload danach entfällt (#872)
    reihenfolge(r.stdout, ["haben-proxy-firma1", `cd ${t.basis}/proxy && docker compose up -d\n`, `cd ${t.basis}/firma1 && ${DB}`, CREATEUSER]);
    expect(r.stdout).not.toContain("caddy reload");
  });

  it("nennt mit --eigener-proxy das Anlegen des Netzes haben-proxy-firma1, das die Override-Datei als extern erwartet", async () => {
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten", "--eigener-proxy");
    expect(r.status).toBe(0);
    expect(t.docker.aufrufe.filter((a) => a.includes("network create"))).toEqual([]);
    reihenfolge(r.stdout, ["docker network create haben-proxy-firma1", `cd ${t.basis}/firma1 && ${DB}`, CREATEUSER]);
    expect(r.stdout).not.toContain("caddy reload");
  });
});

describe("nach einem Abbruch nennen die Schritte das Netz der Instanz (#872)", () => {
  it("mit gemeinsamem Caddy: Er legt haben-proxy-firma1 beim Start an", async () => {
    t.docker.z.dbKaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de");
    reihenfolge(r.stderr, ["haben-proxy-firma1", `cd ${t.basis}/proxy && docker compose up -d\n`, `cd ${t.basis}/firma1 && ${DB}`]);
    expect(r.stderr).not.toContain("caddy reload");
  });

  it("mit --eigener-proxy: docker network create haben-proxy-firma1", async () => {
    t.docker.z.dbKaputt.add("firma1");
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--eigener-proxy");
    reihenfolge(r.stderr, ["docker network create haben-proxy-firma1", `cd ${t.basis}/firma1 && ${DB}`]);
    expect(r.stderr).not.toMatch(/haben-proxy(?!-firma1)/);
  });
});
