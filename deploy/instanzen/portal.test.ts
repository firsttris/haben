/**
 * portal mit nachgebautem docker (#504, #1036): Einrichten hinter dem gemeinsamen Caddy, dann der Abgleich mit den
 * Instanzen mit SSO, samt Farbe und Logo. Ein zweiter Lauf ohne Änderung schreibt nichts und startet nichts neu.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envWerte } from "./env-datei.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
  t.eingabe("geheim\n");
});
afterEach(() => t.aufraeumen());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
const logoZeichen = (d: Uint8Array, farbe: string | null = null) => ({ farbe, logo: { format: "png", sha256: sha(d) } });

const portalDir = () => join(t.basis, "firmenportal");
const roh = (name: string) => readFileSync(join(t.basis, name, ".env"), "utf8");
const env = (name: string) => envWerte(roh(name));
const firmenImPortal = () => env("firmenportal").get("PORTAL_FIRMEN");
/** Aufrufe, die etwas starten oder neu starten, ohne den gemeinsamen Caddy */
const starts = () => t.docker.aufrufe.filter((a) => / compose (up|restart)\b/.test(a) && !a.startsWith("proxy "));
const SSO = ["--oidc-issuer", "https://auth.example.de", "--oidc-client-id"];

async function instanz(name: string, sso = true) {
  const args = sso ? ["--sso", ...SSO, `haben-${name}`, "--oidc-client-secret-stdin"] : [];
  expect((await t.lauf("neu", name, `${name}.example.de`, "--nicht-starten", ...args)).stderr).toBe("");
}

async function einrichten() {
  const r = await t.lauf("portal", "portal.example.de", ...SSO, "haben-firmenportal", "--oidc-client-secret-stdin");
  expect(r.stderr).toBe("");
  return r;
}

async function abgleich() {
  t.docker.aufrufe.length = 0;
  const r = await t.lauf("portal");
  expect(r.stderr).toBe("");
  return r;
}

describe("portal: Einrichten", () => {
  it("legt das Firmenportal hinter dem gemeinsamen Caddy an und nennt die Adressen für den Anmeldedienst", async () => {
    const r = await einrichten();
    const werte = env("firmenportal");
    expect(werte.get("PORTAL_URL")).toBe("https://portal.example.de");
    expect(werte.get("PORTAL_SECRET")?.length).toBeGreaterThanOrEqual(32);
    expect(werte.get("OIDC_ISSUER")).toBe("https://auth.example.de");
    expect(werte.get("OIDC_CLIENT_ID")).toBe("haben-firmenportal");
    expect(werte.get("OIDC_CLIENT_SECRET")).toBe("geheim");
    // Kein haben-…: Sonst hielte das Werkzeug das Firmenportal für eine Instanz
    expect(werte.get("COMPOSE_PROJECT_NAME")).toBe("firmenportal");
    expect(statSync(join(portalDir(), ".env")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(portalDir(), "logos"))).toBe(true);
    expect(readFileSync(join(portalDir(), "compose.override.yml"), "utf8")).toContain("name: haben-proxy-firmenportal");
    expect(readFileSync(join(t.basis, "proxy", "sites", "firmenportal.caddy"), "utf8")).toContain("reverse_proxy haben-firmenportal:3000");
    expect(readFileSync(join(t.basis, "proxy", "compose.override.yml"), "utf8")).toContain("haben-proxy-firmenportal");
    expect(r.stdout).toContain("redirect_uris: [https://portal.example.de/callback]");
    expect(r.stdout).toContain("https://portal.example.de/?abgemeldet=dienst");
    expect(t.docker.aufrufe).toContain("firmenportal compose up -d");
    expect(existsSync(join(portalDir(), ".abgleich.lock"))).toBe(false);
  });

  it("zählt das Firmenportal nicht zu den Instanzen", async () => {
    await instanz("nord");
    await einrichten();
    expect((await t.lauf("liste")).stdout).not.toContain("firmenportal");
  });

  it("verlangt beim ersten Aufruf Domain und Anmeldedienst", async () => {
    const r = await t.lauf("portal");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Das Firmenportal ist noch nicht eingerichtet: portal <domain> --oidc-issuer");
    expect(existsSync(portalDir())).toBe(false);
  });

  it("lehnt danach eine andere Domain und neue Angaben zum Anmeldedienst ab", async () => {
    await einrichten();
    expect((await t.lauf("portal", "anders.example.de")).stderr).toContain("schon für portal.example.de eingerichtet");
    expect((await t.lauf("portal", "portal.example.de", ...SSO, "x", "--oidc-client-secret-stdin")).stderr).toContain("schon eingerichtet");
    expect((await t.lauf("portal", "portal.example.de")).status).toBe(0);
  });

  it("nimmt keine Domain einer Instanz und keinen Namen, der dem Firmenportal gehört", async () => {
    await instanz("nord");
    expect((await t.lauf("portal", "nord.example.de", ...SSO, "x", "--oidc-client-secret-stdin")).stderr).toContain("gehört schon zur Instanz nord");
    expect((await t.lauf("neu", "firmenportal", "fp.example.de")).stderr).toContain("für das Firmenportal reserviert");
  });

  it("richtet nichts ein, wenn die Instanzen einen eigenen Proxy haben, statt einen zweiten Caddy zu starten", async () => {
    expect((await t.lauf("neu", "nord", "nord.example.de", "--nicht-starten", "--eigener-proxy")).status).toBe(0);
    t.docker.aufrufe.length = 0;
    const r = await t.lauf("portal", "portal.example.de", ...SSO, "haben-firmenportal", "--oidc-client-secret-stdin");
    expect(r.stderr).toContain("ohne den gemeinsamen Caddy");
    expect(existsSync(portalDir())).toBe(false);
    expect(existsSync(join(t.basis, "proxy"))).toBe(false);
    expect(t.docker.aufrufe).toEqual([]);
  });

  it("lehnt Optionen von neu ab", async () => {
    expect((await t.lauf("portal", "portal.example.de", "--sso")).stderr).toContain("--sso gilt nur für neu");
  });
});

describe("portal: Abgleich", () => {
  beforeEach(async () => {
    await instanz("nord");
    await instanz("sued");
    await instanz("ohne", false);
    t.docker.z.zeichen.set("nord", { farbe: "#1d4ed8", logo: null });
    t.docker.z.zeichen.set("sued", logoZeichen(PNG));
    t.docker.z.logos.set("sued", PNG);
  });

  it("schreibt Firmen, Farbe und Logo der Instanzen mit SSO und die Adresse des Firmenportals in die Instanzen", async () => {
    const r = await einrichten();
    expect(firmenImPortal()).toBe("nord|https://nord.example.de|haben-nord-inhaber|#1D4ED8;sued|https://sued.example.de|haben-sued-inhaber||sued.png");
    expect(new Uint8Array(readFileSync(join(portalDir(), "logos", "sued.png")))).toEqual(PNG);
    expect(statSync(join(portalDir(), "logos", "sued.png")).mode & 0o777).toBe(0o644);
    expect(env("nord").get("HABEN_FIRMENPORTAL_URL")).toBe("https://portal.example.de");
    expect(env("ohne").get("HABEN_FIRMENPORTAL_URL")).toBeUndefined();
    expect(r.stdout).toMatch(/nord\s+nord\.example\.de\s+#1D4ED8/);
    expect(r.stdout).toMatch(/sued\s+sued\.example\.de\s+Logo/);
    expect(r.stdout).toContain("Ohne SSO, nicht im Firmenportal: ohne");
    // Die Instanzen laufen und bekommen die neue Adresse
    expect(starts()).toEqual(expect.arrayContaining(["nord compose up -d", "sued compose up -d"]));
  });

  it("ändert beim zweiten Lauf ohne Änderung nichts und startet nichts neu", async () => {
    await einrichten();
    const vorher = [roh("firmenportal"), roh("nord"), roh("sued")];
    const r = await abgleich();
    expect([roh("firmenportal"), roh("nord"), roh("sued")]).toEqual(vorher);
    expect(starts()).toEqual([]);
    // Das Logo hat dieselbe Prüfsumme, es wird nicht noch einmal geholt
    expect(t.docker.aufrufe).not.toContain("sued compose exec -T app haben kennzeichen");
    expect(r.stdout).toContain("Nichts geändert.");
  });

  it("startet nach einer neuen Farbe nur das Firmenportal neu, die Instanzen nicht", async () => {
    await einrichten();
    t.docker.z.zeichen.set("nord", { farbe: "#0F766E", logo: null });
    const r = await abgleich();
    expect(firmenImPortal()).toContain("haben-nord-inhaber|#0F766E");
    expect(starts()).toEqual(["firmenportal compose up -d"]);
    expect(r.stdout).toContain("Neu gestartet: Firmenportal");
  });

  it("holt ein neues Logo und startet das Firmenportal nur neu, ohne die .env zu ändern", async () => {
    await einrichten();
    const vorher = roh("firmenportal");
    t.docker.z.zeichen.set("sued", logoZeichen(PNG2));
    t.docker.z.logos.set("sued", PNG2);
    await abgleich();
    expect(roh("firmenportal")).toBe(vorher);
    expect(new Uint8Array(readFileSync(join(portalDir(), "logos", "sued.png")))).toEqual(PNG2);
    expect(starts()).toEqual(["firmenportal compose restart firmenportal"]);
  });

  it("entfernt ein Logo, das keine Firma mehr nennt", async () => {
    await einrichten();
    t.docker.z.zeichen.set("sued", { farbe: null, logo: null });
    await abgleich();
    expect(firmenImPortal()?.endsWith("sued|https://sued.example.de|haben-sued-inhaber")).toBe(true);
    expect(existsSync(join(portalDir(), "logos", "sued.png"))).toBe(false);
  });

  it("bricht mit einem Image ohne Zeichen oder ohne den Befehl haben nicht ab; die Firma bekommt den Buchstaben", async () => {
    t.docker.z.zeichen.delete("nord");
    t.docker.z.zuAlt.add("sued");
    const r = await einrichten();
    expect(firmenImPortal()).toBe("nord|https://nord.example.de|haben-nord-inhaber;sued|https://sued.example.de|haben-sued-inhaber");
    expect(r.stdout).toMatch(/nord\s+nord\.example\.de\s+–/);
  });

  it("nimmt kein Logo, dessen Prüfsumme nicht zur Meldung passt, und warnt auf stderr (cron meldet es auch mit > /dev/null)", async () => {
    t.docker.z.logos.set("sued", PNG2);
    const r = await t.lauf("portal", "portal.example.de", ...SSO, "haben-firmenportal", "--oidc-client-secret-stdin");
    expect(r.status).toBe(0);
    expect(firmenImPortal()).not.toContain("sued.png");
    expect(existsSync(join(portalDir(), "logos", "sued.png"))).toBe(false);
    expect(r.stderr).toContain("Warnung: Das Logo von sued hat eine andere Prüfsumme als gemeldet");
  });

  it("lässt einer gestoppten Instanz Farbe und Logo von bisher und fragt sie nicht", async () => {
    await einrichten();
    t.docker.z.gestoppt.add("nord");
    t.docker.z.gestoppt.add("sued");
    t.docker.z.zeichen.set("nord", { farbe: "#000000", logo: null });
    await abgleich();
    expect(firmenImPortal()).toBe("nord|https://nord.example.de|haben-nord-inhaber|#1D4ED8;sued|https://sued.example.de|haben-sued-inhaber||sued.png");
    expect(t.docker.aufrufe.some((a) => a.includes("haben status"))).toBe(false);
  });

  it("leert HABEN_FIRMEN, das die App neben dem Firmenportal ablehnte, und sagt es", async () => {
    expect((await t.lauf("firmen", "nord", "sued")).status).toBe(0);
    const r = await einrichten();
    expect(env("nord").get("HABEN_FIRMEN")).toBe("");
    expect(r.stdout).toContain("HABEN_FIRMEN geleert (die Liste kommt jetzt aus dem Firmenportal): nord sued");
    // Danach lehnt firmen die Instanzen mit Firmenportal ab
    const firmen = await t.lauf("firmen", "nord");
    expect(firmen.stderr).toContain("nord nutzt das Firmenportal (HABEN_FIRMENPORTAL_URL)");
    expect(env("nord").get("HABEN_FIRMEN")).toBe("");
  });

  it("bricht ohne Inhaber-Gruppe ab und ändert nichts", async () => {
    await einrichten();
    const vorher = [roh("firmenportal"), roh("nord")];
    writeFileSync(join(t.basis, "nord", ".env"), roh("nord").replace(/^OIDC_GROUP_INHABER=.*$/m, ""));
    const ohneGruppe = roh("nord");
    const r = await t.lauf("portal");
    expect(r.stderr).toContain("nord: OIDC_GROUP_INHABER fehlt");
    expect([roh("firmenportal"), roh("nord")]).toEqual([vorher[0], ohneGruppe]);
  });

  it("läuft nicht zweimal zugleich", async () => {
    await einrichten();
    writeFileSync(join(portalDir(), ".abgleich.lock"), "123\n");
    const r = await t.lauf("portal");
    expect(r.stderr).toContain("Ein anderer Abgleich läuft gerade");
    // Die fremde Sperre bleibt
    expect(existsSync(join(portalDir(), ".abgleich.lock"))).toBe(true);
  });

  it("startet das Firmenportal, wenn der erste Abgleich nach dem Einrichten abbrach", async () => {
    writeFileSync(join(t.basis, "nord", ".env"), roh("nord").replace(/^OIDC_GROUP_INHABER=.*$/m, ""));
    expect((await t.lauf("portal", "portal.example.de", ...SSO, "haben-firmenportal", "--oidc-client-secret-stdin")).status).toBe(1);
    expect(t.docker.aufrufe).not.toContain("firmenportal compose up -d");
    writeFileSync(join(t.basis, "nord", ".env"), `${roh("nord")}OIDC_GROUP_INHABER=haben-nord-inhaber\n`);
    await abgleich();
    expect(starts()).toContain("firmenportal compose up -d");
  });

  it("startet ein gestopptes Firmenportal nicht, sagt aber, wie die Änderung gilt", async () => {
    await einrichten();
    t.docker.z.gestoppt.add("firmenportal");
    t.docker.z.zeichen.set("nord", { farbe: "#0F766E", logo: null });
    const r = await abgleich();
    expect(starts()).toEqual([]);
    expect(r.stdout).toContain("Das Firmenportal ist gestoppt; die Änderungen gelten nach:");
  });
});
