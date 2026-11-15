import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePortalFirmen, type PortalFirma } from "@haben/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestProvider, type TestIdentity, type TestProvider } from "../../web/src/server/sso-test-provider.ts";
import { ladeKonfiguration, type PortalConfig } from "./env.ts";
import { ladeLogos, logoAus } from "./logos.ts";
import { cacheLeeren } from "./oidc.ts";
import { portal } from "./server.ts";
import { firmenSeite } from "./seiten.ts";
import { SITZUNG_COOKIE } from "./sitzung.ts";
import { farbStil, STIL } from "./stil.ts";
import { testLogos } from "./test-logos.ts";

/*
 * Farbe und Logo der Firmen im Firmenportal (#1036): aus PORTAL_FIRMEN und PORTAL_LOGOS, nur vom Firmenportal selbst
 * ausgeliefert, Logos nur mit Anmeldung, und eine geänderte Farbe meldet niemanden ab.
 */

const PORTAL = "http://localhost:3116";
const PNG = new Uint8Array(readFileSync(new URL("../../web/public/icon-192.png", import.meta.url)));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const firmenAus = (text: string) => (parsePortalFirmen(text) as { firmen: PortalFirma[] }).firmen;

describe("logoAus", () => {
  it("nimmt PNG und JPEG passend zur Endung, mit Prüfsumme in der Adresse", () => {
    const png = logoAus("nord.png", PNG);
    expect(png).toMatchObject({ typ: "image/png" });
    expect((png as { adresse: string }).adresse).toMatch(/^\/zeichen\/[0-9a-f]{16}\.png$/);
    expect(logoAus("sued.jpg", JPEG)).toMatchObject({ typ: "image/jpeg", adresse: expect.stringMatching(/\.jpg$/) });
  });

  it.each([
    ["leer", "nord.png", new Uint8Array(), "ist leer"],
    ["größer als 1 MB", "nord.png", new Uint8Array(1024 * 1024 + 1), "größer als 1 MB"],
    ["JPEG mit Endung .png", "nord.png", JPEG, "ist kein PNG"],
    ["PNG mit Endung .jpg", "nord.jpg", PNG, "ist kein JPEG"],
    ["kein Bild", "nord.png", new TextEncoder().encode("<svg onload=alert(1)>"), "ist kein PNG"],
  ])("lehnt ein Logo ab, das %s ist", (_fall, datei, daten, grund) => {
    expect(logoAus(datei, new Uint8Array(daten))).toEqual({ grund: expect.stringContaining(grund) });
  });
});

describe("Logos jeder Größe (#1036, Rückfrage in #1044)", () => {
  it.each(testLogos().map((l) => [l.wozu, l] as const))("nimmt das erfundene Logo an: %s", (_wozu, logo) => {
    expect(logoAus(logo.datei, logo.daten)).toMatchObject({ typ: "image/png", adresse: expect.stringMatching(/^\/zeichen\/[0-9a-f]{16}\.png$/) });
  });

  it("skaliert das Logo wie das Zeichen in der Navigation von Haben (.brand-logo)", () => {
    const regel = (css: string, name: string) => new RegExp(`\\.${name} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const haben = regel(readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8"), "brand-logo");
    const portal = regel(STIL, "firma-logo");
    for (const angabe of ["object-fit: contain", "padding: 3px", "background: #fff", "display: block"]) {
      expect(haben, `Haben: ${angabe}`).toContain(angabe);
      expect(portal, `Firmenportal: ${angabe}`).toContain(angabe);
    }
    // Die Größe kommt von .firma-zeichen, 32px wie die Kacheln mit Buchstaben
    expect(regel(STIL, "firma-zeichen")).toMatch(/width: 32px; height: 32px/);
  });
});

describe("ladeLogos", () => {
  let verzeichnis: string;
  beforeAll(() => {
    verzeichnis = mkdtempSync(join(tmpdir(), "firmenportal-logos-"));
    writeFileSync(join(verzeichnis, "nord.png"), PNG);
    writeFileSync(join(verzeichnis, "kaputt.png"), "kein Bild");
  });
  afterAll(() => rmSync(verzeichnis, { recursive: true, force: true }));

  it("lädt die genannten Logos und warnt bei fehlenden oder kaputten, ohne abzubrechen", async () => {
    const firmen = firmenAus(
      "Studio Nord|https://nord.example.de|n||nord.png;Werkstatt Süd|https://sued.example.de|s||fehlt.png;Atelier West|https://west.example.de|w||kaputt.png",
    );
    const warnungen: string[] = [];
    const logos = await ladeLogos(verzeichnis, firmen, (w) => warnungen.push(w));
    expect([...logos.keys()]).toEqual(["nord.png"]);
    expect(warnungen).toEqual([
      "Firmenportal: Logo „fehlt.png“ für „Werkstatt Süd“ fehlt; die Firma zeigt ihren Anfangsbuchstaben.",
      "Firmenportal: Logo „kaputt.png“ für „Atelier West“ ist kein PNG; die Firma zeigt ihren Anfangsbuchstaben.",
    ]);
  });

  it("lädt ohne Verzeichnis nichts", async () => {
    expect((await ladeLogos(undefined, firmenAus("Studio Nord|https://nord.example.de|n"), () => {})).size).toBe(0);
  });
});

describe("Konfiguration", () => {
  const basis = {
    PORTAL_URL: PORTAL,
    PORTAL_SECRET: "portal-test-secret-mindestens-32-zeichen",
    OIDC_ISSUER: "https://auth.example.de",
    OIDC_CLIENT_ID: "haben",
    OIDC_CLIENT_SECRET: "secret",
  };

  it("verlangt PORTAL_LOGOS, wenn PORTAL_FIRMEN Logos nennt", () => {
    expect(ladeKonfiguration({ ...basis, PORTAL_FIRMEN: "Studio Nord|https://nord.example.de|n||nord.png" })).toEqual({
      fehler: ["PORTAL_LOGOS: PORTAL_FIRMEN nennt Logos, aber kein Verzeichnis dafür"],
    });
  });

  it("braucht PORTAL_LOGOS nicht für Farben allein", () => {
    expect(ladeKonfiguration({ ...basis, PORTAL_FIRMEN: "Studio Nord|https://nord.example.de|n|#1D4ED8" })).toHaveProperty("config");
  });
});

describe("farbStil", () => {
  it("setzt je Farbe Fläche und Schrift mit dem besseren Kontrast", () => {
    const stil = farbStil(firmenAus("A|https://a.example.de|a|#1D4ED8;B|https://b.example.de|b|#FDE68A;C|https://c.example.de|c|#1d4ed8"));
    expect(stil).toContain(".firma-zeichen.farbe-1D4ED8 { background: #1D4ED8; color: #FFFFFF;");
    expect(stil).toContain(".firma-zeichen.farbe-FDE68A { background: #FDE68A; color: #000000;");
    // Dieselbe Farbe nur einmal
    expect(stil.match(/farbe-1D4ED8 \{ background/g)).toHaveLength(1);
  });

  it("gibt einer Kachel eine Kante, wo sie sich nicht mit 3 : 1 von der Karte abhebt", () => {
    const stil = farbStil(firmenAus("Hell|https://a.example.de|a|#FDE68A;Dunkel|https://b.example.de|b|#111827"));
    const [hell, dunkel] = stil.split("@media (prefers-color-scheme: dark)") as [string, string];
    expect(hell).toMatch(/farbe-FDE68A \{[^}]*inset 0 0 0 1px/);
    expect(hell).toMatch(/farbe-111827 \{[^}]*box-shadow: none/);
    expect(dunkel).toMatch(/farbe-FDE68A \{[^}]*box-shadow: none/);
    expect(dunkel).toMatch(/farbe-111827 \{[^}]*inset 0 0 0 1px/);
  });

  it("ist ohne Farben leer", () => {
    expect(farbStil(firmenAus("A|https://a.example.de|a"))).toBe("");
  });
});

describe("Kachel", () => {
  const seite = (firma: Parameters<typeof firmenSeite>[0][number]) => firmenSeite([firma], "", "", (u) => u);

  it("zeigt das Logo statt des Buchstabens, ohne eigenen Namen für Screenreader", () => {
    const html = seite({ name: "Studio Nord", url: "https://nord.example.de", farbe: "#1D4ED8", logo: "/zeichen/0123456789abcdef.png" });
    // Wie .brand-logo in Haben ist das Bild selbst die Kachel; mit leerem alt zählt es für Screenreader nicht
    expect(html).toContain('<img class="firma-zeichen firma-logo" src="/zeichen/0123456789abcdef.png" alt="" width="32" height="32">');
    expect(html).toContain('<span class="firma-name">Studio Nord</span>');
  });

  it("zeigt ohne Logo den Buchstaben in der Farbe der Firma", () => {
    expect(seite({ name: "studio Nord", url: "https://nord.example.de", farbe: "#1D4ED8", logo: null })).toContain(
      '<span class="firma-zeichen farbe-1D4ED8" aria-hidden="true">S</span>',
    );
  });

  it("bleibt ohne Farbe und Logo wie bisher", () => {
    expect(seite({ name: "Studio Nord", url: "https://nord.example.de" })).toContain('<span class="firma-zeichen" aria-hidden="true">S</span>');
  });

  it("bindet das Stylesheet der Farben nur ein, wenn es eins gibt", () => {
    expect(firmenSeite([], "", "", (u) => u, "/farben.css?v=abc")).toContain('<link rel="stylesheet" href="/farben.css?v=abc">');
    expect(firmenSeite([], "", "", (u) => u)).not.toContain("farben.css");
  });
});

describe("Firmenportal mit Farbe und Logo", () => {
  let provider: TestProvider;
  let verzeichnis: string;

  beforeAll(async () => {
    provider = await startTestProvider();
    verzeichnis = mkdtempSync(join(tmpdir(), "firmenportal-logos-"));
    writeFileSync(join(verzeichnis, "nord.png"), PNG);
    writeFileSync(join(verzeichnis, "west.jpg"), JPEG);
  });
  afterAll(async () => {
    await provider.close();
    rmSync(verzeichnis, { recursive: true, force: true });
  });
  beforeEach(() => {
    cacheLeeren();
    provider.setDiscovery("ok");
    provider.setEndSession(false);
    provider.setDiscoveryFelder(undefined);
  });

  const LISTE = [
    "Studio Nord|https://nord.example.de|haben-nord-inhaber|#1D4ED8|nord.png",
    "Werkstatt Süd|https://sued.example.de|haben-sued-inhaber|#B45309",
    "Atelier West|https://west.example.de|haben-west-inhaber||west.jpg",
  ];

  function konfiguration(firmen: string[]): PortalConfig {
    const geladen = ladeKonfiguration({
      PORTAL_URL: PORTAL,
      PORTAL_SECRET: "portal-test-secret-mindestens-32-zeichen",
      PORTAL_FIRMEN: firmen.join(";"),
      PORTAL_LOGOS: verzeichnis,
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: "haben",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_DISPLAY_NAME: "Test-SSO",
    });
    if ("fehler" in geladen) throw new Error(geladen.fehler.join("; "));
    return geladen.config;
  }

  async function handlerFuer(firmen: string[]) {
    const config = konfiguration(firmen);
    return portal(config, Date.now, await ladeLogos(config.logos, config.firmen, () => {}));
  }

  const anfrage = (pfad: string, cookies: Record<string, string> = {}) =>
    new Request(`${PORTAL}${pfad}`, {
      headers: {
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
    });
  const cookiesAus = (antwort: Response) => Object.fromEntries(antwort.headers.getSetCookie().map((c) => c.split(";")[0]!.split("=", 2) as [string, string]));

  /** Bis zur Sitzung; danach gilt sie für jeden Handler mit derselben Liste */
  async function anmelden(handler: Awaited<ReturnType<typeof handlerFuer>>, identity: TestIdentity) {
    const start = await handler(anfrage("/anmelden?von=haben"));
    const authorize = new URL(start.headers.get("location")!);
    const callback = new URL(`${PORTAL}/callback`);
    callback.searchParams.set("code", provider.issue(authorize, identity));
    callback.searchParams.set("state", authorize.searchParams.get("state")!);
    const ende = await handler(anfrage(`${callback.pathname}${callback.search}`, cookiesAus(start)));
    expect(ende.status).toBe(303);
    return { [SITZUNG_COOKIE]: cookiesAus(ende)[SITZUNG_COOKIE]! };
  }

  const NORD_SUED = { sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber", "haben-sued-inhaber"] };

  it("zeigt das Logo und die Farbe der Firmen, die Links heißen weiter wie die Firmen", async () => {
    const handler = await handlerFuer(LISTE);
    const cookies = await anmelden(handler, NORD_SUED);
    const seite = await (await handler(anfrage("/", cookies))).text();
    const logo = seite.match(/<img class="firma-zeichen firma-logo" src="(\/zeichen\/[0-9a-f]{16}\.png)" alt=""/)?.[1];
    expect(logo).toBeDefined();
    expect(seite).toContain('<span class="firma-zeichen farbe-B45309" aria-hidden="true">W</span><span class="firma-name">Werkstatt Süd</span>');
    expect(seite).toMatch(/<link rel="stylesheet" href="\/farben\.css\?v=[0-9a-f]{12}">/);
    expect(seite).not.toContain("Atelier West");

    const bild = await handler(anfrage(logo!, cookies));
    expect(bild.status).toBe(200);
    expect(bild.headers.get("content-type")).toBe("image/png");
    expect(bild.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(bild.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await bild.arrayBuffer())).toEqual(PNG);
  });

  it("gibt Logos nur an eine Sitzung, zu deren Firmen sie gehören", async () => {
    const handler = await handlerFuer(LISTE);
    const alle = await anmelden(handler, { sub: "b", email: "b@example.de", groups: ["haben-nord-inhaber", "haben-west-inhaber"] });
    const seite = await (await handler(anfrage("/", alle))).text();
    const west = seite.match(/<img class="firma-zeichen firma-logo" src="(\/zeichen\/[0-9a-f]{16}\.jpg)"/)?.[1];
    expect(west).toBeDefined();
    expect((await handler(anfrage(west!))).status).toBe(404);
    const nurNord = await anmelden(handler, { sub: "c", email: "c@example.de", groups: ["haben-nord-inhaber"] });
    expect((await handler(anfrage(west!, nurNord))).status).toBe(404);
    expect((await handler(anfrage(west!, alle))).status).toBe(200);
    expect((await handler(anfrage("/zeichen/../nord.png", alle))).status).toBe(404);
  });

  it("liefert die Farben als eigenes Stylesheet; die CSP erlaubt Bilder nur vom Firmenportal", async () => {
    const handler = await handlerFuer(LISTE);
    const cookies = await anmelden(handler, NORD_SUED);
    const farben = await handler(anfrage("/farben.css", cookies));
    expect(farben.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(farben.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(await farben.text()).toContain(".firma-zeichen.farbe-1D4ED8 { background: #1D4ED8;");
    const csp = (await handler(anfrage("/", cookies))).headers.get("content-security-policy")!;
    expect(csp).toContain("img-src 'self';");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/(img|style|font|default)-src[^;]*(https?:|\*|data:|'unsafe-inline')/);
  });

  it("gibt Farben nur an eine Sitzung und nur die ihrer Firmen (Bedingung in #1036)", async () => {
    const handler = await handlerFuer([LISTE[0]!, LISTE[1]!, LISTE[2]!.replace("||west.jpg", "|#7C3AED|west.jpg")]);
    expect((await handler(anfrage("/farben.css"))).status).toBe(404);
    const farben = await (await handler(anfrage("/farben.css", await anmelden(handler, NORD_SUED)))).text();
    expect(farben).toContain("farbe-1D4ED8");
    expect(farben).toContain("farbe-B45309");
    // Atelier West sieht diese Person nicht, also auch nicht ihre Farbe
    expect(farben).not.toContain("7C3AED");
  });

  it("ändert die Adresse des Stylesheets mit den Farben", async () => {
    const adresse = async (liste: string[]) => {
      const handler = await handlerFuer(liste);
      return (await (await handler(anfrage("/", await anmelden(handler, NORD_SUED)))).text()).match(/farben\.css\?v=([0-9a-f]+)/)?.[1];
    };
    const vorher = await adresse(LISTE);
    expect(await adresse([LISTE[0]!.replace("#1D4ED8", "#0F766E"), LISTE[1]!, LISTE[2]!])).not.toBe(vorher);
  });

  it("meldet nach einer neuen Farbe oder einem neuen Logo niemanden ab, nach einer neuen Firma schon", async () => {
    const cookies = await anmelden(await handlerFuer(LISTE), NORD_SUED);
    const neueZeichen = await handlerFuer([LISTE[0]!.replace("#1D4ED8|nord.png", "#0F766E|"), LISTE[1]!.replace("#B45309", ""), LISTE[2]!]);
    const seite = await neueZeichen(anfrage("/", cookies));
    expect(seite.status).toBe(200);
    expect(await seite.text()).toContain('<span class="firma-zeichen farbe-0F766E" aria-hidden="true">S</span>');
    const neueFirma = await handlerFuer([...LISTE, "Laden Ost|https://ost.example.de|haben-ost-inhaber"]);
    expect((await neueFirma(anfrage("/", cookies))).status).toBe(303);
  });

  it("zeigt den Buchstaben, wenn das Logo nicht geladen werden konnte", async () => {
    const handler = await handlerFuer(["Studio Nord|https://nord.example.de|haben-nord-inhaber|#1D4ED8|fehlt.png", LISTE[1]!]);
    const seite = await (await handler(anfrage("/", await anmelden(handler, NORD_SUED)))).text();
    expect(seite).toContain('<span class="firma-zeichen farbe-1D4ED8" aria-hidden="true">S</span><span class="firma-name">Studio Nord</span>');
    expect(seite).not.toContain("<img");
  });
});
