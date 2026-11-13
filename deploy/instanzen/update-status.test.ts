/**
 * update, status und liste mit nachgebautem docker: Stopp beim ersten Fehler, Neustart-Schleife als Fehler, Werte
 * nur aus der .env der Instanz, Stand aus `haben status --json` (#504).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const drei = async () => {
  for (const n of ["firma1", "firma2", "firma3"]) await t.lauf("neu", n, `${n}.example.de`, "--nicht-starten");
  t.docker.aufrufe.length = 0;
  t.docker.umgebungen.length = 0;
};

describe("update", () => {
  beforeEach(drei);

  it("sichert und aktualisiert alle der Reihe nach", async () => {
    const r = await t.lauf("update");
    expect(r.status).toBe(0);
    const schritte = t.docker.aufrufe.filter((a) => /backup\.sh| pull| up -d/.test(a));
    expect(schritte).toEqual(
      ["firma1", "firma2", "firma3"].flatMap((n) => [`${n} compose exec -T backup backup.sh`, `${n} compose pull`, `${n} compose up -d`]),
    );
    expect(r.stdout.split("\n").filter((z) => z === "aktualisiert")).toHaveLength(3);
  });

  it("stoppt bei der ersten fehlgeschlagenen Instanz und nennt sie", async () => {
    t.docker.z.kaputt.add("firma2");
    const r = await t.lauf("update");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2: Die App ist nach dem Update nicht gesund");
    expect(t.docker.aufrufe.some((a) => a.startsWith("firma3 "))).toBe(false);
  });

  it("stoppt, wenn die Sicherung vorher fehlschlägt, ohne zu aktualisieren", async () => {
    t.docker.z.backupKaputt.add("firma1");
    const r = await t.lauf("update");
    expect(r.stderr).toContain("firma1: Sicherung vor dem Update fehlgeschlagen");
    expect(t.docker.aufrufe.filter((a) => / pull| up -d/.test(a))).toEqual([]);
  });

  it("überspringt eine gestoppte Instanz und nennt sie am Ende", async () => {
    t.docker.z.gestoppt.add("firma2");
    const r = await t.lauf("update");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Nicht aktualisiert, weil gestoppt: firma2");
    expect(t.docker.aufrufe).toContain("firma3 compose up -d");
    expect(t.docker.aufrufe.some((a) => a.startsWith("firma2 compose pull"))).toBe(false);
  });

  it("hält an, wenn Compose für eine Instanz einen Fehler meldet, statt sie als gestoppt zu überspringen", async () => {
    t.docker.z.composeKaputt.add("firma2");
    const r = await t.lauf("update");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2: docker compose meldet einen Fehler");
    expect(t.docker.aufrufe.some((a) => a.startsWith("firma3 compose pull"))).toBe(false);
  });

  it("überspringt eine App, die ständig neu startet, nicht als gestoppt", async () => {
    // Nach einer fehlgeschlagenen Migration startet die App immer wieder neu: Das ist ein Fehler, keine gestoppte Instanz
    t.docker.z.schleife.add("firma2");
    const r = await t.lauf("update");
    expect(r.stdout).not.toContain("gestoppt, übersprungen");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("firma2: Die App startet ständig neu");
    expect(t.docker.aufrufe.some((a) => a.startsWith("firma2 compose pull") || a.startsWith("firma3 compose pull"))).toBe(false);
  });

  it("lässt in der Shell gesetzte COMPOSE_PROJECT_NAME, COMPOSE_FILE und COMPOSE_PROFILES nicht an docker compose durch", async () => {
    // Compose gibt Variablen aus der Shell Vorrang vor der .env (geprüft mit docker compose config): Mit
    // COMPOSE_PROJECT_NAME=haben-firma1 in der Shell liefe update in firma2 gegen Container und Volumes von firma1
    t.shell({ COMPOSE_PROJECT_NAME: "haben-firma1", COMPOSE_FILE: "compose.yml", COMPOSE_PROFILES: "eigener-proxy", COMPOSE_ENV_FILES: "/tmp/x" });
    expect((await t.lauf("update")).status).toBe(0);
    const compose = t.docker.umgebungen.filter((u) => u.aufruf.includes(" compose "));
    expect(compose.length).toBeGreaterThan(0);
    for (const { env } of compose) expect(Object.keys(env).filter((k) => k.startsWith("COMPOSE_"))).toEqual([]);
  });

  it("lässt in der Shell exportierte Schlüssel aus der .env wie ENCRYPTION_KEY oder DOMAIN nicht an docker compose durch", async () => {
    t.shell({ ENCRYPTION_KEY: "fremd", DOMAIN: "firma1.example.de", DB_PASSWORD: "fremd", AUTH_SECRET: "fremd", DOCKER_HOST: "unix:///var/run/docker.sock" });
    expect((await t.lauf("update")).status).toBe(0);
    for (const { env } of t.docker.umgebungen) {
      expect(env).not.toHaveProperty("ENCRYPTION_KEY");
      expect(env).not.toHaveProperty("DOMAIN");
      expect(env).not.toHaveProperty("DB_PASSWORD");
      expect(env).not.toHaveProperty("AUTH_SECRET");
      // Den Daemon wählt die Person weiterhin selbst
      expect(env).toMatchObject({ DOCKER_HOST: "unix:///var/run/docker.sock", PATH: "/usr/bin:/bin" });
    }
  });
});

describe("status und liste", () => {
  const zeilen = (stdout: string) => stdout.trim().split("\n");

  it("zeigt je Instanz Version, Erreichbarkeit, ERiC und Sicherung aus haben status und meldet eine gestoppte", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    await t.lauf("neu", "firma2", "firma2.example.de", "--nicht-starten");
    t.docker.z.gestoppt.add("firma2");
    const r = await t.lauf("status");
    expect(r.status).toBe(0);
    expect(zeilen(r.stdout)[0]).toMatch(/^Instanz\s+Domain\s+Version\s+Erreichbar\s+ERiC\s+Letzte Sicherung$/);
    expect(zeilen(r.stdout)[1]).toMatch(/^firma1\s+firma1\.example\.de\s+9\.9\.9\s+ja\s+44\.3\.6\.0\s+2026-11-10 03:15$/);
    expect(zeilen(r.stdout)[2]).toMatch(/^firma2\s+firma2\.example\.de\s+gestoppt\s+ja\s+–\s+–$/);
    expect(t.docker.aufrufe).toContain("firma1 compose exec -T app haben status --json");
  });

  it("meldet ein Image ohne den Befehl haben als zu alt", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    t.docker.z.zuAlt.add("firma1");
    expect(zeilen((await t.lauf("status")).stdout)[1]).toMatch(/^firma1\s+firma1\.example\.de\s+\? \(Image zu alt\)\s+ja\s/);
  });

  it("zeigt eine nicht erreichbare Instanz mit dem HTTP-Status", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    const { main } = await import("./haben-instanzen.ts");
    const aus: string[] = [];
    for (const [code, text] of [
      [null, "nein (000)"],
      [502, "nein (502)"],
    ] as const) {
      aus.length = 0;
      await main(["--basis", t.basis, "status"], {
        vorlagen: "",
        ausfuehren: t.docker.ausfuehren,
        shell: {},
        abrufen: async () => code,
        schlafen: async () => {},
        warten: 0,
        takt: 0,
        aus: (z) => aus.push(z),
        fehler: () => {},
      });
      expect(aus[1]).toContain(text);
    }
  });

  it("zeigt eine Instanz, bei der Compose einen Fehler meldet, als Fehler und die Sicherung nicht als gestoppt", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    t.docker.z.composeKaputt.add("firma1");
    const r = await t.lauf("status");
    expect(r.status).toBe(0);
    expect(zeilen(r.stdout)[1]).toMatch(/^firma1\s+firma1\.example\.de\s+Fehler\s/);
    expect(zeilen(r.stdout)[1]).toContain("? (Compose-Fehler)");
  });

  it("zeigt eine App, die ständig neu startet, nicht als gestoppt", async () => {
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    t.docker.z.schleife.add("firma1");
    const zeile = zeilen((await t.lauf("status")).stdout)[1];
    expect(zeile).not.toMatch(/\sgestoppt\s/);
    expect(zeile).toMatch(/\sstartet neu\s/);
  });

  it("findet auch Instanzen, die nach der Doku von Hand angelegt sind, und nichts anderes", async () => {
    mkdirSync(join(t.basis, "haben-alt"), { recursive: true });
    writeFileSync(join(t.basis, "haben-alt", "compose.yml"), "");
    writeFileSync(join(t.basis, "haben-alt", ".env"), "COMPOSE_PROJECT_NAME=haben-alt\nDOMAIN=alt.example.de\n");
    mkdirSync(join(t.basis, "fremd"), { recursive: true });
    writeFileSync(join(t.basis, "fremd", "compose.yml"), "");
    writeFileSync(join(t.basis, "fremd", ".env"), "COMPOSE_PROJECT_NAME=etwas\n");
    await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
    const namen = zeilen((await t.lauf("liste")).stdout).map((z) => z.split(/\s+/)[0]);
    expect(namen).toEqual(["firma1", "haben-alt"]);
  });

  it("nimmt Optionen von neu bei anderen Befehlen nicht an", async () => {
    const r = await t.lauf("update", "--sso");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("Fehler: --sso gilt nur für neu.");
    expect((await t.lauf("loeschen")).stderr).toContain("Unbekannter Befehl: loeschen");
    expect((await t.lauf("liste", "--unbekannt")).stderr).toBe("Fehler: Unbekannte Option: --unbekannt");
  });
});
