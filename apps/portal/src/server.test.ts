import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestProvider, type TestIdentity, type TestProvider } from "../../web/src/server/sso-test-provider.ts";
import { ladeKonfiguration, type PortalConfig } from "./env.ts";
import { cacheLeeren } from "./oidc.ts";
import { portal } from "./server.ts";
import { ABLAUF_COOKIE, SITZUNG_COOKIE, signieren } from "./sitzung.ts";

/*
 * Portal (#504, Stufe 2) gegen einen echten OIDC-Anbieter auf Loopback (sso-test-provider.ts): Anmeldung, Callback,
 * Auswahl der Firmen nur aus den Inhaber-Gruppen, Ablehnungen und manipulierte Cookies.
 */

const PORTAL = "http://localhost:3116";
const FIRMEN = [
  "Werkstatt Süd|https://sued.example.de|haben-sued-inhaber",
  "Studio Nord|https://nord.example.de|haben-nord-inhaber",
  "Atelier West|https://west.example.de|haben-west-inhaber",
].join(";");

let provider: TestProvider;
let config: PortalConfig;

beforeAll(async () => {
  provider = await startTestProvider();
});
afterAll(async () => {
  await provider.close();
});
beforeEach(() => {
  cacheLeeren();
  provider.setDiscovery("ok");
  const geladen = ladeKonfiguration({
    PORTAL_URL: PORTAL,
    PORTAL_SECRET: "portal-test-secret-mindestens-32-zeichen",
    PORTAL_FIRMEN: FIRMEN,
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: "haben",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_DISPLAY_NAME: "Test-SSO",
  });
  if ("fehler" in geladen) throw new Error(geladen.fehler.join("; "));
  config = geladen.config;
});

/** Name und Ziel jeder Firma auf der Seite, in Reihenfolge */
const firmenAuf = (seite: string) =>
  [...seite.matchAll(/<a class="firma" href="([^"]+)">.*?<span class="firma-name">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
/** Ohne Sitzung leitet / gleich zur Anmeldung beim Anmeldedienst */
const zurAnmeldung = (antwort: Response) => {
  expect(antwort.status).toBe(303);
  expect(antwort.headers.get("location")).toBe("/anmelden");
};

const cookiesAus = (antwort: Response) => Object.fromEntries(antwort.headers.getSetCookie().map((c) => c.split(";")[0]!.split("=", 2) as [string, string]));

const anfrage = (pfad: string, cookies: Record<string, string> = {}, method = "GET") =>
  new Request(`${PORTAL}${pfad}`, {
    method,
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });

/** Der ganze Weg bis zur Antwort des Callbacks; `stoeren` verändert den Callback vor dem Senden */
async function anmelden(identity: TestIdentity, stoeren?: (callback: URL, cookies: Record<string, string>) => void) {
  const handler = portal(config);
  const start = await handler(anfrage("/anmelden"));
  expect(start.status).toBe(303);
  const authorize = new URL(start.headers.get("location")!);
  const cookies = cookiesAus(start);
  const callback = new URL(`${PORTAL}/callback`);
  callback.searchParams.set("code", provider.issue(authorize, identity));
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  stoeren?.(callback, cookies);
  const ende = await handler(anfrage(`${callback.pathname}${callback.search}`, cookies));
  return { handler, authorize, ende, cookies: cookiesAus(ende) };
}

describe("Anmeldung", () => {
  it("leitet mit PKCE, state und nonce zum Anmeldedienst", async () => {
    const { authorize } = await anmelden({ sub: "a", email: "a@example.de", groups: [] });
    expect(authorize.origin).toBe(provider.issuer);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${PORTAL}/callback`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("scope")).toBe("openid profile email groups");
    expect(authorize.searchParams.get("nonce")).toBeTruthy();
  });

  it("zeigt nur die Firmen aus den eigenen Inhaber-Gruppen, nach Namen sortiert", async () => {
    const { handler, ende, cookies } = await anmelden({
      sub: "inhaberin",
      email: "inhaberin@example.de",
      groups: ["familie", "haben-sued-inhaber", "haben-nord-inhaber", "haben-west-steuerberatung"],
    });
    expect(ende.status).toBe(303);
    expect(ende.headers.get("location")).toBe("/");
    expect(cookies[ABLAUF_COOKIE]).toBe("");
    const seite = await (await handler(anfrage("/", cookies))).text();
    // Die Links starten in Haben gleich die SSO-Anmeldung, ohne Klick auf der Login-Seite der Instanz
    expect(firmenAuf(seite)).toEqual([
      ["Studio Nord", "https://nord.example.de/login?anmelden=sso"],
      ["Werkstatt Süd", "https://sued.example.de/login?anmelden=sso"],
    ]);
    expect(seite).not.toContain("Atelier West");
    expect(seite).toContain("Angemeldet als inhaberin@example.de");
  });

  it("escapt den Namen der Person", async () => {
    const { handler, cookies } = await anmelden({ sub: "x", email: "<b>eva</b>@example.de", groups: ["haben-nord-inhaber", "haben-sued-inhaber"] });
    const seite = await (await handler(anfrage("/", cookies))).text();
    expect(seite).toContain("Angemeldet als &lt;b&gt;eva&lt;/b&gt;@example.de");
    expect(seite).not.toContain("<b>eva");
  });

  it("leitet ohne Sitzung gleich zum Anmeldedienst, nach dem Abmelden nicht", async () => {
    zurAnmeldung(await portal(config)(anfrage("/")));
    const abgemeldet = await portal(config)(anfrage("/?abgemeldet"));
    expect(abgemeldet.status).toBe(200);
    expect(await abgemeldet.text()).toContain("Du bist abgemeldet.");
  });

  it("leitet mit genau einer Firma direkt dorthin", async () => {
    const { ende } = await anmelden({ sub: "b", email: "b@example.de", groups: ["haben-west-inhaber"] });
    expect(ende.headers.get("location")).toBe("https://west.example.de/login?anmelden=sso");
  });

  it("nennt ohne passende Gruppe keine Firma; die Steuerberatung zählt nicht", async () => {
    const { handler, cookies } = await anmelden({ sub: "k", email: "k@example.de", groups: ["haben-nord-steuerberatung"] });
    const seite = await (await handler(anfrage("/", cookies))).text();
    expect(seite).toContain("in keiner Firma als Inhaber");
    expect(seite).not.toMatch(/example\.de"/);
  });
});

describe("Ablehnungen", () => {
  const abgelehnt = async (ende: Response) => {
    expect(ende.status).toBeGreaterThanOrEqual(400);
    expect(ende.headers.getSetCookie().some((c) => c.startsWith(`${SITZUNG_COOKIE}=`))).toBe(false);
  };

  it("bei falschem state", async () => {
    const { ende } = await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"] }, (cb) => cb.searchParams.set("state", "fremd"));
    await abgelehnt(ende);
  });

  it("ohne Cookie des Ablaufs", async () => {
    const { ende } = await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"] }, (_cb, cookies) => {
      delete cookies[ABLAUF_COOKIE];
    });
    await abgelehnt(ende);
  });

  it("bei falscher Nonce im ID-Token", async () => {
    const { ende } = await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"] }, (cb, cookies) => {
      // Ein gültig signierter Ablauf mit anderer Nonce, aber passendem state und Verifier geht nicht: Verifier
      // und Challenge passen dann nicht mehr. Deshalb nur die Nonce tauschen, der Rest bleibt
      const [wert] = cookies[ABLAUF_COOKIE]!.split(".");
      const inhalt = JSON.parse(Buffer.from(wert!, "base64url").toString("utf8"));
      inhalt.ablauf.nonce = "andere";
      cookies[ABLAUF_COOKIE] = signieren(config.secret, { typ: "ablauf", ablauf: inhalt.ablauf }, inhalt.bis);
      expect(cb.searchParams.get("state")).toBe(inhalt.ablauf.state);
    });
    await abgelehnt(ende);
    expect(await ende.text()).toContain("Die Anmeldung ist nicht möglich.");
  });

  it("bei fremder Signatur des ID-Tokens", async () => {
    await abgelehnt((await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"], wrongKey: true })).ende);
  });

  it("bei abgelaufenem ID-Token", async () => {
    await abgelehnt((await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"], idTokenSeconds: -120 })).ende);
  });

  it("wenn UserInfo ein anderes Subject nennt", async () => {
    await abgelehnt((await anmelden({ sub: "a", email: "a@example.de", groups: ["haben-nord-inhaber"], userInfo: { sub: "b" } })).ende);
  });

  it.each([
    ["ohne Gruppen-Claim", undefined],
    ["mit Gruppen als Text", "haben-nord-inhaber"],
  ])("%s", async (_fall, groups) => {
    await abgelehnt((await anmelden({ sub: "a", email: "a@example.de", groups })).ende);
  });

  it("bei einem Abbruch beim Anmeldedienst", async () => {
    const ende = await portal(config)(anfrage("/callback?error=access_denied&state=x"));
    await abgelehnt(ende);
    expect(await ende.text()).toContain("abgebrochen");
  });

  it("wenn die Discovery nicht antwortet, ohne Details auf der Seite", async () => {
    provider.setDiscovery("fehler");
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const ende = await portal(config)(anfrage("/anmelden"));
    expect(ende.status).toBe(403);
    expect(await ende.text()).not.toContain("503");
    expect(fehler).toHaveBeenCalledWith("Portal: Discovery antwortete 503");
    fehler.mockRestore();
  });
});

describe("Sitzung", () => {
  const sitzung = async () =>
    (await anmelden({ sub: "inhaberin", email: "i@example.de", groups: ["haben-nord-inhaber", "haben-sued-inhaber"] })).cookies[SITZUNG_COOKIE]!;

  it("gilt nach 15 Minuten nicht mehr", async () => {
    const wert = await sitzung();
    const spaeter = portal(config, () => Date.now() + 15 * 60_000 + 1);
    zurAnmeldung(await spaeter(anfrage("/", { [SITZUNG_COOKIE]: wert })));
  });

  it("gilt mit veränderter Liste der Firmen nicht mehr", async () => {
    const wert = await sitzung();
    const andere = { ...config, firmen: [...config.firmen].reverse() };
    zurAnmeldung(await portal(andere)(anfrage("/", { [SITZUNG_COOKIE]: wert })));
  });

  it("gilt nicht, wenn jemand die Firmen im Cookie ändert", async () => {
    const wert = await sitzung();
    const [inhalt, sig] = wert.split(".");
    const daten = JSON.parse(Buffer.from(inhalt!, "base64url").toString("utf8"));
    daten.sitzung.firmen = [0, 1, 2];
    const gefaelscht = `${Buffer.from(JSON.stringify(daten)).toString("base64url")}.${sig}`;
    zurAnmeldung(await portal(config)(anfrage("/", { [SITZUNG_COOKIE]: gefaelscht })));
  });

  it("endet mit Abmelden", async () => {
    const ende = await portal(config)(anfrage("/abmelden", { [SITZUNG_COOKIE]: await sitzung() }, "POST"));
    expect(ende.status).toBe(303);
    // Ohne end_session_endpoint (Testanbieter) auf die Seite „abgemeldet“, nicht gleich wieder zur Anmeldung
    expect(ende.headers.get("location")).toBe("/?abgemeldet");
    expect(ende.headers.getSetCookie()).toContain(`${SITZUNG_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});

describe("Seiten", () => {
  it("setzen sichere Kopfzeilen und Cookies nur mit __Host-, Secure und HttpOnly", async () => {
    const start = await portal(config)(anfrage("/anmelden"));
    const cookie = start.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^__Host-haben-portal-ablauf=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
    const seite = await portal(config)(anfrage("/?abgemeldet"));
    expect(seite.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(seite.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(seite.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(seite.headers.get("cache-control")).toBe("no-store");
  });

  it("liefern IBM Plex Sans selbst aus", async () => {
    for (const gewicht of [400, 500, 600]) {
      const schrift = await portal(config)(anfrage(`/schrift/plex-${gewicht}.woff2`));
      expect(schrift.status).toBe(200);
      expect(schrift.headers.get("content-type")).toBe("font/woff2");
      expect((await schrift.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    }
  });

  it("antworten auf /gesund ohne Anmeldung", async () => {
    expect(await (await portal(config)(anfrage("/gesund"))).text()).toBe("ok");
  });

  it("kennen keine anderen Pfade", async () => {
    expect((await portal(config)(anfrage("/admin"))).status).toBe(404);
    expect((await portal(config)(anfrage("/abmelden"))).status).toBe(404);
  });
});
