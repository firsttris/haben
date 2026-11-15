/**
 * Befunde aus dem TDD-Review von portal (#1036): Rechte der Logos bei restriktiver umask, Neustarts, die ein
 * abgebrochener Lauf schuldig blieb, und HABEN_FIRMENPORTAL_URL in einer Instanz, die kein SSO mehr hat (Runde 1); eine
 * solche Instanz, die deshalb ständig neu startet (Runde 2).
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ausfuehren } from "./ausfuehren.ts";
import { envWerte } from "./env-datei.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
  t.eingabe("geheim\n");
});
afterEach(() => t.aufraeumen());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
const portalDir = () => join(t.basis, "firmenportal");
const env = (name: string) => envWerte(readFileSync(join(t.basis, name, ".env"), "utf8"));
const SSO = ["--oidc-issuer", "https://auth.example.de", "--oidc-client-id"];
const starts = () => t.docker.aufrufe.filter((a) => / compose (up|restart)\b/.test(a) && !a.startsWith("proxy "));
const einrichten = () => t.lauf("portal", "portal.example.de", ...SSO, "haben-firmenportal", "--oidc-client-secret-stdin");

async function instanz(name: string) {
  expect((await t.lauf("neu", name, `${name}.example.de`, "--nicht-starten", "--sso", ...SSO, `haben-${name}`, "--oidc-client-secret-stdin")).stderr).toBe("");
}

describe("Review portal", () => {
  it("Logos und ihr Verzeichnis bleiben auch mit umask 027 für den Container (USER bun) lesbar", async () => {
    await instanz("sued");
    t.docker.z.zeichen.set("sued", { farbe: null, logo: { format: "png", sha256: sha(PNG) } });
    t.docker.z.logos.set("sued", PNG);
    const alt = process.umask(0o027);
    try {
      expect((await einrichten()).stderr).toBe("");
    } finally {
      process.umask(alt);
    }
    expect(statSync(join(portalDir(), "logos")).mode & 0o777).toBe(0o755);
    expect(statSync(join(portalDir(), "logos", "sued.png")).mode & 0o777).toBe(0o644);
  });

  it("startet nach einem fehlgeschlagenen Neustart beim nächsten Lauf die Instanzen neu, die die Adresse noch nicht haben", async () => {
    await instanz("nord");
    await instanz("sued");
    // Erster Lauf: nord startet nicht neu; sued kommt gar nicht erst dran
    t.docker.z.upKaputt.add("nord");
    const erster = await einrichten();
    expect(erster.status).toBe(1);
    expect(erster.stderr).toContain("nord: Neustart fehlgeschlagen");
    expect(env("sued").get("HABEN_FIRMENPORTAL_URL")).toBe("https://portal.example.de");
    // Behoben; der nächste Lauf (etwa aus cron) muss nord und sued neu starten, sonst laufen sie ohne Firmenportal
    t.docker.z.upKaputt.delete("nord");
    t.docker.aufrufe.length = 0;
    const zweiter = await t.lauf("portal");
    expect(zweiter.status).toBe(0);
    expect(starts()).toEqual(expect.arrayContaining(["nord compose up -d", "sued compose up -d"]));
    expect(zweiter.stdout).not.toContain("Nichts geändert.");
    // Danach ist nichts mehr offen
    t.docker.aufrufe.length = 0;
    expect((await t.lauf("portal")).stdout).toContain("Nichts geändert.");
    expect(starts()).toEqual([]);
  });

  it("startet das Firmenportal beim nächsten Lauf neu, wenn up -d nach einer neuen Farbe scheiterte", async () => {
    await instanz("nord");
    expect((await einrichten()).status).toBe(0);
    t.docker.z.zeichen.set("nord", { farbe: "#0F766E", logo: null });
    t.docker.z.upKaputt.add("firmenportal");
    const erster = await t.lauf("portal");
    expect(erster.stderr).toContain("Das Firmenportal ließ sich nicht starten");
    expect(env("firmenportal").get("PORTAL_FIRMEN")).toContain("#0F766E");
    t.docker.z.upKaputt.delete("firmenportal");
    t.docker.aufrufe.length = 0;
    const zweiter = await t.lauf("portal");
    expect(starts()).toContain("firmenportal compose up -d");
    expect(zweiter.stdout).not.toContain("Nichts geändert.");
  });

  it("nimmt HABEN_FIRMENPORTAL_URL wieder heraus, wenn eine Instanz kein SSO mehr hat (die App lehnte sie sonst ab)", async () => {
    await instanz("nord");
    expect((await einrichten()).status).toBe(0);
    expect(env("nord").get("HABEN_FIRMENPORTAL_URL")).toBe("https://portal.example.de");
    const datei = join(t.basis, "nord", ".env");
    writeFileSync(datei, readFileSync(datei, "utf8").replace(/^OIDC_ONLY=.*$/m, "OIDC_ONLY=false"));
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("portal");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Ohne SSO, nicht im Firmenportal: nord");
    // apps/web/src/server/env.ts: HABEN_FIRMENPORTAL_URL „nur mit SSO (OIDC_ONLY=true)“
    expect(env("nord").get("HABEN_FIRMENPORTAL_URL") ?? "").toBe("");
    expect(starts()).toContain("nord compose up -d");
  });

  it("baut eine Instanz ohne SSO neu auf, die wegen HABEN_FIRMENPORTAL_URL ständig neu startet, statt sie für gestoppt zu halten", async () => {
    await instanz("nord");
    expect((await einrichten()).status).toBe(0);
    // SSO in nord von Hand abgeschaltet und neu gestartet: Die App lehnt HABEN_FIRMENPORTAL_URL ohne OIDC_ONLY=true
    // ab (apps/web/src/server/env.ts) und startet ständig neu, mit der alten Adresse im Container
    const datei = join(t.basis, "nord", ".env");
    writeFileSync(datei, readFileSync(datei, "utf8").replace(/^OIDC_ONLY=.*$/m, "OIDC_ONLY=false"));
    t.docker.z.schleife.add("nord");
    // Erst up -d baut den Container mit der .env ohne Adresse neu auf; danach läuft die App wieder
    const echt: Ausfuehren = t.docker.ausfuehren;
    t.docker.ausfuehren = async (befehl, o) => {
      const r = await echt(befehl, o);
      if (o.cwd.endsWith("/nord") && befehl.slice(1).join(" ") === "compose up -d") t.docker.z.schleife.delete("nord");
      return r;
    };
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("portal");
    expect(env("nord").get("HABEN_FIRMENPORTAL_URL") ?? "").toBe("");
    expect(r.stdout).not.toContain("Gestoppt, nur die .env geändert: nord");
    expect(starts()).toContain("nord compose up -d");
  });
});
