/**
 * firmen und neu --firmenname mit nachgebautem docker (#909): dieselbe Liste HABEN_FIRMEN in jeder gewählten Instanz,
 * vorher geprüft wie die App, laufende Apps neu, gestoppte bleiben gestoppt. Fälle zum Teil aus dem früheren
 * Bash-Entwurf (#549) und seinen Review-Runden.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envWerte } from "./env-datei.ts";
import { HILFE } from "./haben-instanzen.ts";
import { umgebung, VORLAGEN } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const roh = (name: string) => readFileSync(join(t.basis, name, ".env"), "utf8");
const env = (name: string) => envWerte(roh(name));
const anhaengen = (name: string, zeile: string) => writeFileSync(join(t.basis, name, ".env"), `${roh(name)}${zeile}\n`);
const ups = () => t.docker.aufrufe.filter((a) => / compose up /.test(a) && !a.startsWith("proxy "));

async function anlegen(...namen: string[]) {
  for (const n of namen) expect((await t.lauf("neu", n, `${n}.example.de`, "--nicht-starten")).status).toBe(0);
  t.docker.aufrufe.length = 0;
}

/** Alle .env der Basis, um zu prüfen, dass ein Abbruch keine Datei geändert hat */
const alle = (...namen: string[]) => namen.map((n) => roh(n));

/** Von Hand nach der Doku angelegt: Verzeichnis haben-…, gleichnamiges Projekt */
function vonHand(dir: string, domain: string, compose = readFileSync(join(VORLAGEN, "compose.yml"), "utf8")) {
  mkdirSync(join(t.basis, dir), { recursive: true });
  writeFileSync(join(t.basis, dir, "compose.yml"), compose);
  writeFileSync(join(t.basis, dir, ".env"), `COMPOSE_PROJECT_NAME=${dir}\nDOMAIN=${domain}\n`);
}

describe("firmen", () => {
  it("schreibt in jede Instanz dieselbe Liste samt ihr selbst, mit HABEN_FIRMENNAME oder dem Namen der Instanz", async () => {
    await anlegen("firma1", "firma2", "firma3");
    anhaengen("firma2", "HABEN_FIRMENNAME='Werkstatt Süd'");
    const r = await t.lauf("firmen");
    expect(r.status, r.stderr).toBe(0);
    const liste = "firma1|https://firma1.example.de;Werkstatt Süd|https://firma2.example.de;firma3|https://firma3.example.de";
    expect(["firma1", "firma2", "firma3"].map((n) => env(n).get("HABEN_FIRMEN"))).toEqual([liste, liste, liste]);
  });

  it("setzt nur die Zeile HABEN_FIRMEN in einfachen Anführungszeichen und lässt alles andere stehen", async () => {
    await anlegen("firma1", "firma2");
    const vorher = roh("firma1").split("\n");
    await t.lauf("firmen");
    const nachher = roh("firma1").split("\n");
    const geaendert = nachher.filter((z, i) => z !== vorher[i]);
    expect(geaendert).toEqual(["HABEN_FIRMEN='firma1|https://firma1.example.de;firma2|https://firma2.example.de'"]);
    expect(nachher).toHaveLength(vorher.length);
    expect(nachher.some((z) => z.startsWith("# HABEN_FIRMEN="))).toBe(true);
  });

  it("ändert beim zweiten Lauf keine Datei", async () => {
    await anlegen("firma1", "firma2");
    await t.lauf("firmen");
    const vorher = alle("firma1", "firma2");
    expect((await t.lauf("firmen")).status).toBe(0);
    expect(alle("firma1", "firma2")).toEqual(vorher);
  });

  it("bringt laufende Apps auf den Stand ihrer .env, wartet auf sie und lässt gestoppte gestoppt", async () => {
    await anlegen("firma1", "firma2", "firma3");
    t.docker.z.gestoppt.add("firma2");
    const r = await t.lauf("firmen");
    expect(r.status, r.stderr).toBe(0);
    expect(ups()).toEqual(["firma1 compose up -d", "firma3 compose up -d"]);
    // Gewartet wird auf die gesunde App, wie in update
    const nachUp = t.docker.aufrufe.slice(t.docker.aufrufe.indexOf("firma1 compose up -d") + 1);
    expect(nachUp[0]).toBe("firma1 compose ps -a --format json");
    expect(r.stdout).toContain("Gestoppt, nur die .env geändert: firma2");
    expect(env("firma2").get("HABEN_FIRMEN")).toContain("firma2|https://firma2.example.de");
  });

  it("startet auch eine laufende App neu, deren .env die Liste schon hat", async () => {
    // Etwa nach einer Änderung von Hand ohne Neustart: Compose erstellt einen unveränderten Container nicht neu
    await anlegen("firma1", "firma2");
    await t.lauf("firmen");
    t.docker.aufrufe.length = 0;
    await t.lauf("firmen");
    expect(ups()).toEqual(["firma1 compose up -d", "firma2 compose up -d"]);
  });

  it("hält an, wenn eine App nach dem Neustart nicht gesund wird, und nennt sie", async () => {
    await anlegen("firma1", "firma2", "firma3");
    t.docker.z.kaputt.add("firma2");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2");
    expect(r.stderr).toContain("docker compose logs app");
    expect(ups()).toEqual(["firma1 compose up -d", "firma2 compose up -d"]);
  });

  it("hält an, wenn up -d fehlschlägt, und nennt die Instanz", async () => {
    await anlegen("firma1", "firma2");
    t.docker.z.upKaputt.add("firma1");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma1");
    expect(ups()).toEqual(["firma1 compose up -d"]);
  });

  it.each([
    ["schleife", "firma2: Die App startet ständig neu"],
    ["composeKaputt", "firma2: docker compose meldet einen Fehler"],
  ] as const)("ändert keine Datei, wenn eine gewählte Instanz vorher %s ist", async (zustand, meldung) => {
    await anlegen("firma1", "firma2");
    const vorher = alle("firma1", "firma2");
    t.docker.z[zustand].add("firma2");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(meldung);
    expect(alle("firma1", "firma2")).toEqual(vorher);
    expect(ups()).toEqual([]);
  });

  it("bricht bei einem doppelten Firmennamen ab, nennt beide Instanzen und ändert keine Datei", async () => {
    await anlegen("firma1", "firma2", "firma3");
    anhaengen("firma1", "HABEN_FIRMENNAME='Studio Nord'");
    anhaengen("firma3", "HABEN_FIRMENNAME='Studio Nord'");
    const vorher = alle("firma1", "firma2", "firma3");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("„Studio Nord“");
    expect(r.stderr).toContain("firma1");
    expect(r.stderr).toContain("firma3");
    expect(alle("firma1", "firma2", "firma3")).toEqual(vorher);
    expect(ups()).toEqual([]);
  });

  it("bricht ab, wenn der Name einer Instanz dem Firmennamen einer anderen gleicht", async () => {
    await anlegen("firma1", "firma2");
    anhaengen("firma2", "HABEN_FIRMENNAME=firma1");
    expect((await t.lauf("firmen")).stderr).toContain("„firma1“");
  });

  it.each([
    ["zu lang", "Garten- und Landschaftsbau Müller und Söhne GmbH & Co. KG Süd"],
    ["mit |", "'A|B'"],
    ["mit ;", "'A;B'"],
    ["mit Leerzeichen am Ende", "'Studio Nord '"],
    ["mit Steuerzeichen", '"A\\nB"'],
    ["leer in Anführungszeichen", "''"],
  ])("bricht bei einem Firmennamen %s aus der .env ab, nennt die Instanz und ändert keine Datei", async (_, wert) => {
    await anlegen("firma1", "firma2");
    anhaengen("firma2", `HABEN_FIRMENNAME=${wert}`);
    const vorher = alle("firma1", "firma2");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2");
    expect(alle("firma1", "firma2")).toEqual(vorher);
  });

  it("bricht ab, wenn zwei Instanzen dieselbe Domain nennen", async () => {
    await anlegen("firma1");
    vonHand("haben-alt", "Firma1.Example.de");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("https://firma1.example.de");
    expect(r.stderr).toContain("haben-alt");
  });

  it("bricht bei einer Instanz ohne gültige Domain ab", async () => {
    await anlegen("firma1");
    vonHand("haben-alt", "");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("haben-alt");
  });

  it("schreibt höchstens 50 Firmen", async () => {
    for (let i = 1; i <= 51; i++) vonHand(`haben-f${i}`, `f${i}.example.de`);
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Höchstens 50");
    expect(env("haben-f1").get("HABEN_FIRMEN")).toBeUndefined();
  });

  it("schreibt nichts, wenn die compose.yml einer Instanz HABEN_FIRMEN nicht an die App weitergibt", async () => {
    // Die Vorlage reicht die Variable erst seit #905 durch; eine ältere compose.yml bliebe beim Anlegen stehen
    await anlegen("firma1");
    const alt = readFileSync(join(VORLAGEN, "compose.yml"), "utf8")
      .split("\n")
      .filter((z) => !z.includes("HABEN_FIRMEN"))
      .join("\n");
    vonHand("haben-alt", "alt.example.de", alt);
    const vorher = alle("firma1", "haben-alt");
    const r = await t.lauf("firmen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("haben-alt/compose.yml");
    expect(r.stderr).toContain("deploy/compose.yml");
    expect(alle("firma1", "haben-alt")).toEqual(vorher);
    expect(ups()).toEqual([]);
  });

  it("zeigt am Ende Name, Domain und Eintrag in der Liste", async () => {
    await anlegen("firma1", "firma2");
    anhaengen("firma2", "HABEN_FIRMENNAME='Werkstatt Süd'");
    const zeilen = (await t.lauf("firmen")).stdout.split("\n");
    expect(zeilen.some((z) => /^firma2\s+firma2\.example\.de\s+Werkstatt Süd$/.test(z))).toBe(true);
  });
});

describe("firmen mit Auswahl", () => {
  it("schreibt nur in die genannten Instanzen, die übrigen bleiben unverändert und stehen in keiner Liste", async () => {
    await anlegen("firma1", "firma2", "firma3");
    const vorher = roh("firma2");
    const r = await t.lauf("firmen", "firma3", "firma1");
    expect(r.status, r.stderr).toBe(0);
    // In der Reihenfolge der Basis, wie ohne Auswahl
    const liste = "firma1|https://firma1.example.de;firma3|https://firma3.example.de";
    expect([env("firma1").get("HABEN_FIRMEN"), env("firma3").get("HABEN_FIRMEN")]).toEqual([liste, liste]);
    expect(roh("firma2")).toBe(vorher);
    expect(ups()).toEqual(["firma1 compose up -d", "firma3 compose up -d"]);
  });

  it("prüft nur die Firmennamen der Auswahl", async () => {
    // Gleiche Namen in zwei Gruppen verschiedener Leute in derselben Basis
    await anlegen("firma1", "firma2", "firma3");
    anhaengen("firma1", "HABEN_FIRMENNAME='Studio Nord'");
    anhaengen("firma3", "HABEN_FIRMENNAME='Studio Nord'");
    expect((await t.lauf("firmen", "firma1", "firma2")).status).toBe(0);
  });

  it("lehnt einen unbekannten Namen ab und ändert keine Datei", async () => {
    await anlegen("firma1", "firma2");
    const vorher = alle("firma1", "firma2");
    const r = await t.lauf("firmen", "firma1", "firma9");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma9");
    expect(alle("firma1", "firma2")).toEqual(vorher);
  });

  it("nennt eine nicht gewählte Instanz, deren Liste noch eine gewählte enthält, und lässt sie unverändert", async () => {
    await anlegen("firma1", "firma2", "firma3");
    await t.lauf("firmen");
    const vorher = roh("firma3");
    const r = await t.lauf("firmen", "firma1", "firma2");
    expect(r.status).toBe(0);
    expect(roh("firma3")).toBe(vorher);
    expect(env("firma1").get("HABEN_FIRMEN")).not.toContain("firma3");
    expect(r.stdout).toMatch(/firma3.*firma1, firma2/);
  });
});

describe("neu --firmenname", () => {
  it("legt den Namen als HABEN_FIRMENNAME ab und ohne Angabe keinen", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de", "--firmenname", "Studio Nord & Söhne", "--nicht-starten")).status).toBe(0);
    expect(roh("firma1")).toContain("HABEN_FIRMENNAME='Studio Nord & Söhne'\n");
    await t.lauf("neu", "firma2", "firma2.example.de", "--nicht-starten");
    expect(env("firma2").has("HABEN_FIRMENNAME")).toBe(false);
  });

  it.each(["A|B", "A;B", "it's", "", " Nord", "Nord ", "x".repeat(61), "A\tB"])("lehnt %j ab, bevor etwas angelegt ist", async (name) => {
    const r = await t.lauf("neu", "firma1", "firma1.example.de", "--firmenname", name, "--nicht-starten");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--firmenname");
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("schreibt die Liste nicht in andere Instanzen, startet keine neu und nennt den Befehl firmen", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de")).status).toBe(0);
    await t.lauf("firmen");
    const vorher = roh("firma1");
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("neu", "firma2", "firma2.example.de", "--firmenname", "Werkstatt");
    expect(r.status, r.stderr).toBe(0);
    expect(roh("firma1")).toBe(vorher);
    expect(t.docker.aufrufe.some((a) => a.startsWith("firma1 compose up"))).toBe(false);
    expect(env("firma2").get("HABEN_FIRMEN") ?? "").toBe("");
    expect(r.stdout).toContain("bun deploy/instanzen/haben-instanzen.ts firmen");
  });

  it("nennt den Befehl firmen auch mit --nicht-starten", async () => {
    expect((await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten")).stdout).toContain("haben-instanzen.ts firmen");
  });
});

describe("Aufruf", () => {
  it("nimmt --firmenname nur bei neu und bei firmen keine Option für neu", async () => {
    expect((await t.lauf("firmen", "--firmenname", "X")).stderr).toContain("--firmenname gilt nur für neu");
    expect((await t.lauf("liste", "--firmenname", "X")).stderr).toContain("--firmenname gilt nur für neu");
    expect((await t.lauf("firmen", "--nicht-starten")).stderr).toContain("--nicht-starten gilt nur für neu");
  });

  it("nennt firmen und --firmenname in der Hilfe", () => {
    expect(HILFE).toMatch(/haben-instanzen\.ts firmen \[<name> …\]/);
    expect(HILFE).toContain("--firmenname NAME");
  });
});
