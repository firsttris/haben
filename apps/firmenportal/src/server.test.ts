import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestProvider, type TestIdentity, type TestProvider } from "../../web/src/server/sso-test-provider.ts";
import { ladeKonfiguration, type PortalConfig } from "./env.ts";
import { cacheLeeren } from "./oidc.ts";
import { portal } from "./server.ts";
import { ABLAUF_COOKIE, ABMELDE_COOKIE, SITZUNG_COOKIE, signieren } from "./sitzung.ts";

/*
 * Firmenportal (#504, Stufe 2) gegen einen echten OIDC-Anbieter auf Loopback (sso-test-provider.ts): Anmeldung, Callback,
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
  provider.setEndSession(false);
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
async function anmelden(identity: TestIdentity, stoeren?: (callback: URL, cookies: Record<string, string>) => void, beginn = "/anmelden") {
  const handler = portal(config);
  const start = await handler(anfrage(beginn));
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
    expect(await abgemeldet.text()).toContain("Du bist im Firmenportal abgemeldet.");
  });

  it("leitet mit genau einer Firma direkt dorthin", async () => {
    const { ende } = await anmelden({ sub: "b", email: "b@example.de", groups: ["haben-west-inhaber"] });
    expect(ende.headers.get("location")).toBe("https://west.example.de/login?anmelden=sso");
  });

  // Aus Haben („Zum Firmenportal“) will man das Firmenportal sehen, auch mit nur einer Firma; sonst landete man wieder in
  // derselben Instanz (Rückmeldung in #1006)
  it("zeigt aus Haben (?von=haben) auch bei genau einer Firma die Liste", async () => {
    const ohneSitzung = await portal(config)(anfrage("/?von=haben"));
    expect(ohneSitzung.status).toBe(303);
    expect(ohneSitzung.headers.get("location")).toBe("/anmelden?von=haben");
    const { handler, ende, cookies } = await anmelden({ sub: "b", email: "b@example.de", groups: ["haben-west-inhaber"] }, undefined, "/anmelden?von=haben");
    expect(ende.headers.get("location")).toBe("/");
    const seite = await (await handler(anfrage("/", cookies))).text();
    expect(firmenAuf(seite)).toEqual([["Atelier West", "https://west.example.de/login?anmelden=sso"]]);
  });

  it("nimmt den Weg aus Haben nur aus dem signierten Ablauf, nicht aus dem Callback", async () => {
    const { ende } = await anmelden({ sub: "b", email: "b@example.de", groups: ["haben-west-inhaber"] }, (callback) => {
      callback.searchParams.set("von", "haben");
    });
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
    expect(fehler).toHaveBeenCalledWith("Firmenportal: Discovery antwortete 503");
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

  // Rückmeldung in #1006: Abmelden mit id_token_hint und post_logout_redirect_uri (OpenID Connect RP-Initiated Logout
  // 1.0, 2), damit der Anmeldedienst die Sitzung ohne Rückfrage beenden und zum Firmenportal zurückleiten kann
  it("leitet zur Abmeldung beim Anmeldedienst mit id_token_hint, client_id und Rückweg", async () => {
    provider.setEndSession(true);
    const { handler, cookies } = await anmelden({ sub: "inhaberin", email: "i@example.de", groups: ["haben-nord-inhaber", "haben-sued-inhaber"] });
    expect(cookies[ABMELDE_COOKIE]).toBeTruthy();
    const ende = await handler(anfrage("/abmelden", cookies, "POST"));
    expect(ende.status).toBe(303);
    const ziel = new URL(ende.headers.get("location")!);
    expect(`${ziel.origin}${ziel.pathname}`).toBe(`${provider.issuer}/logout`);
    expect(ziel.searchParams.get("client_id")).toBe("haben");
    expect(ziel.searchParams.get("post_logout_redirect_uri")).toBe(`${PORTAL}/?abgemeldet=dienst`);
    expect(ziel.searchParams.get("id_token_hint")?.split(".")).toHaveLength(3);
    const geloescht = ende.headers.getSetCookie();
    expect(geloescht).toContain(`${SITZUNG_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
    expect(geloescht).toContain(`${ABMELDE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });

  it("nimmt den id_token_hint nur aus dem signierten Cookie", async () => {
    provider.setEndSession(true);
    const ende = await portal(config)(anfrage("/abmelden", { [ABMELDE_COOKIE]: "eyJhbGciOiJub25lIn0.e30." }, "POST"));
    const ziel = new URL(ende.headers.get("location")!);
    expect(ziel.searchParams.has("id_token_hint")).toBe(false);
    expect(ziel.searchParams.get("post_logout_redirect_uri")).toBe(`${PORTAL}/?abgemeldet=dienst`);
  });

  it("sagt nach dem Rückweg vom Anmeldedienst, dass man auch dort abgemeldet ist", async () => {
    const seite = await (await portal(config)(anfrage("/?abgemeldet=dienst"))).text();
    expect(seite).toContain("Du bist im Firmenportal und bei Test-SSO abgemeldet.");
  });

  it("sagt ohne Abmeldung beim Anmeldedienst, dass man dort angemeldet bleibt", async () => {
    const seite = await (await portal(config)(anfrage("/?abgemeldet"))).text();
    expect(seite).toContain("Du bist im Firmenportal abgemeldet. Bei Test-SSO bist du weiter angemeldet");
    expect(seite).toContain("Wieder anmelden");
  });

  it("endet mit Abmelden", async () => {
    const ende = await portal(config)(anfrage("/abmelden", { [SITZUNG_COOKIE]: await sitzung() }, "POST"));
    expect(ende.status).toBe(303);
    // Ohne end_session_endpoint (Testanbieter) auf die Seite „abgemeldet“, nicht gleich wieder zur Anmeldung
    expect(ende.headers.get("location")).toBe("/?abgemeldet");
    expect(ende.headers.getSetCookie()).toContain(`${SITZUNG_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});

// Rückmeldung in #1006: Wie Haben (rateLimit in apps/web/src/server/auth.ts) begrenzt das Firmenportal die Anmeldewege je
// Client-Adresse; hinter dem Reverse Proxy kommt sie aus X-Forwarded-For, sonst von der Verbindung
describe("Begrenzung der Anmeldewege", () => {
  const von = (pfad: string, adresse: string) => new Request(`${PORTAL}${pfad}`, { headers: { "x-forwarded-for": adresse } });

  it("lässt je Adresse und Minute 20 Starts der Anmeldung zu, dann 429 mit Retry-After", async () => {
    let uhr = Date.now();
    const handler = portal(config, () => uhr);
    for (let i = 0; i < 20; i++) expect((await handler(von("/anmelden", "203.0.113.5"))).status).toBe(303);
    const zuViel = await handler(von("/anmelden", "203.0.113.5"));
    expect(zuViel.status).toBe(429);
    expect(Number(zuViel.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(zuViel.headers.getSetCookie()).toEqual([]);
    expect(await zuViel.text()).toContain("Zu viele Anmeldeversuche");
    // Andere Adresse, anderer Weg und nach Ablauf der Minute geht es weiter
    expect((await handler(von("/anmelden", "203.0.113.6"))).status).toBe(303);
    expect((await handler(von("/callback?error=access_denied", "203.0.113.5"))).status).toBe(400);
    uhr += 60_001;
    expect((await handler(von("/anmelden", "203.0.113.5"))).status).toBe(303);
  });

  it("begrenzt den Callback eigens, ohne Anfrage an den Anmeldedienst", async () => {
    const handler = portal(config);
    for (let i = 0; i < 20; i++) await handler(von("/callback?code=x&state=y", "203.0.113.7"));
    expect((await handler(von("/callback?code=x&state=y", "203.0.113.7"))).status).toBe(429);
  });

  it("nimmt die letzte Adresse aus X-Forwarded-For, die der Reverse Proxy setzt", async () => {
    const handler = portal(config);
    for (let i = 0; i < 20; i++) await handler(von("/anmelden", `198.51.100.${i}, 203.0.113.8`));
    expect((await handler(von("/anmelden", "203.0.113.8"))).status).toBe(429);
  });

  it("zählt ohne X-Forwarded-For die Adresse der Verbindung", async () => {
    const handler = portal(config);
    for (let i = 0; i < 20; i++) await handler(anfrage("/anmelden"), "192.0.2.1");
    expect((await handler(anfrage("/anmelden"), "192.0.2.1")).status).toBe(429);
    expect((await handler(anfrage("/anmelden"), "192.0.2.2")).status).toBe(303);
  });

  it("begrenzt Seiten außerhalb der Anmeldung nicht", async () => {
    const handler = portal(config);
    for (let i = 0; i < 25; i++) expect((await handler(von("/gesund", "203.0.113.9"))).status).toBe(200);
  });
});

describe("Seiten", () => {
  it("setzen sichere Kopfzeilen und Cookies nur mit __Host-, Secure und HttpOnly", async () => {
    const start = await portal(config)(anfrage("/anmelden"));
    const cookie = start.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^__Host-haben-firmenportal-ablauf=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
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

// TDD-Review #1006
describe("Review: Abmelden", () => {
  /** Cookies wie im Browser: Set-Cookie überschreibt, Max-Age=0 (leerer Wert) löscht */
  const glas = (...stufen: Record<string, string>[]) => {
    const ergebnis: Record<string, string> = {};
    for (const stufe of stufen)
      for (const [k, v] of Object.entries(stufe)) {
        if (v === "") delete ergebnis[k];
        else ergebnis[k] = v;
      }
    return ergebnis;
  };
  const subjectAus = (idToken: string) => JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString("utf8")).sub;

  it("schickt nach der Anmeldung einer anderen Person nicht deren altes ID-Token als id_token_hint", async () => {
    provider.setEndSession(true);
    const erste = await anmelden({ sub: "anna", email: "anna@example.de", groups: ["haben-nord-inhaber", "haben-sued-inhaber"] });
    const nachErster = glas(erste.cookies);
    expect(nachErster[ABMELDE_COOKIE]).toBeTruthy();
    // Im selben Browser meldet sich danach jemand mit einem ID-Token an, das nicht mehr ins Cookie passt
    const zweite = await anmelden(
      { sub: "bert", email: `${"b".repeat(3000)}@example.de`, groups: ["haben-nord-inhaber", "haben-sued-inhaber"] },
      (_cb, cookies) => Object.assign(cookies, { ...nachErster, ...cookies }),
    );
    expect(zweite.ende.status).toBe(303);
    const browser = glas(nachErster, zweite.cookies);
    const ende = await zweite.handler(anfrage("/abmelden", browser, "POST"));
    const hint = new URL(ende.headers.get("location")!).searchParams.get("id_token_hint");
    // Entweder kein Hinweis oder einer zur angemeldeten Person, nie das ID-Token von anna
    if (hint) expect(subjectAus(hint)).toBe("bert");
  });

  it("meldet auf ein Formular einer fremden Seite nicht ab", async () => {
    provider.setEndSession(true);
    const handler = portal(config);
    // Ein Formular auf einer fremden Seite: SameSite=Lax schickt keine Cookies mit, Origin und Sec-Fetch-Site nennen die fremde Seite
    const fremd = new Request(`${PORTAL}/abmelden`, { method: "POST", headers: { origin: "https://angreifer.example", "sec-fetch-site": "cross-site" } });
    const ende = await handler(fremd);
    expect(ende.status).toBe(403);
    expect(ende.headers.get("location")).toBeNull();
  });
});

describe("Review: Weg aus Haben", () => {
  it("behält ?von=haben, wenn die Anmeldung abgebrochen wurde und man es noch einmal versucht", async () => {
    const handler = portal(config);
    const start = await handler(anfrage("/anmelden?von=haben"));
    const authorize = new URL(start.headers.get("location")!);
    // Abbruch beim Anmeldedienst (oder Ablauf nach zehn Minuten auf dessen Seite)
    const abbruch = await handler(anfrage(`/callback?error=access_denied&state=${authorize.searchParams.get("state")}`, cookiesAus(start)));
    expect(abbruch.status).toBe(400);
    const nochmal = (await abbruch.text()).match(/<a class="btn btn-primary" href="([^"]+)">/)![1]!;
    // Der zweite Versuch führt bei genau einer Firma sonst zurück in dieselbe Instanz
    const { ende } = await anmelden({ sub: "b", email: "b@example.de", groups: ["haben-west-inhaber"] }, undefined, nochmal.replaceAll("&amp;", "&"));
    expect(ende.headers.get("location")).toBe("/");
  });
});
