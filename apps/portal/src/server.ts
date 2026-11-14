import { type Firma, portalFirmenFuer } from "@haben/core";
import type { PortalConfig } from "./env.ts";
import { abschliessen, anmeldeAdresse, entdecken, istAnmeldeFehler } from "./oidc.ts";
import { schrift } from "./schrift.ts";
import { abgemeldetSeite, anmeldeSeite, fehlerSeite, firmenSeite } from "./seiten.ts";
import { STIL } from "./stil.ts";
import {
  ABLAUF_COOKIE,
  ABLAUF_MS,
  cookieLesen,
  cookieLoeschen,
  cookieSetzen,
  listenAbdruck,
  pruefen,
  SITZUNG_COOKIE,
  SITZUNG_MS,
  signieren,
} from "./sitzung.ts";

/*
 * Das Portal (#504, Stufe 2): Anmeldung per SSO, danach die Firmen, in deren Inhaber-Gruppe die Person ist, als Links
 * auf ihre Instanzen. Keine Datenbank, keine Buchhaltungsdaten, kein Proxy: Die Instanz meldet beim selben
 * Anmeldedienst selbst an.
 */

/** Content Security Policy; `formZiele` sind weitere Origins, zu denen ein Formular (auch per Weiterleitung) führen darf */
const csp = (formZiele: string[] = []) =>
  `default-src 'none'; style-src 'self'; font-src 'self'; form-action ${["'self'", ...formZiele].join(" ")}; frame-ancestors 'none'; base-uri 'none'`;

const KOPF = {
  "content-security-policy": csp(),
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

const antwort = (body: string, status = 200, extra: Record<string, string> = {}, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", ...KOPF, ...extra });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
};

const weiter = (ziel: string, cookies: string[] = []) => antwort("", 303, { location: ziel }, cookies);

/**
 * Der Einstieg in eine Instanz: Haben startet mit ?anmelden=sso die SSO-Anmeldung selbst (SsoSignIn), ohne Klick auf
 * der Login-Seite. Ist man dort schon angemeldet, leitet /login auf die Übersicht.
 */
const einstieg = (url: string) => `${url}/login?anmelden=sso`;

/** Die Firmen einer gültigen Sitzung und wer angemeldet ist, sonst null (abgelaufen, manipuliert oder andere Liste) */
function sitzungLesen(config: PortalConfig, request: Request, jetzt: number): { firmen: Firma[]; anzeige: string } | null {
  const inhalt = pruefen(config.secret, cookieLesen(request, SITZUNG_COOKIE), "sitzung", jetzt);
  if (!inhalt || inhalt.sitzung.liste !== listenAbdruck(config.firmen)) return null;
  const sichtbar = inhalt.sitzung.firmen.map((i) => config.firmen[i]).filter((f) => f !== undefined);
  const firmen = portalFirmenFuer(
    sichtbar.map((f) => f.gruppe),
    sichtbar,
  );
  return { firmen, anzeige: typeof inhalt.sitzung.anzeige === "string" ? inhalt.sitzung.anzeige : "" };
}

async function anmelden(config: PortalConfig, jetzt: number): Promise<Response> {
  const meta = await entdecken(config, jetzt);
  const { ablauf, adresse } = anmeldeAdresse(config, meta);
  return weiter(adresse, [cookieSetzen(ABLAUF_COOKIE, signieren(config.secret, { typ: "ablauf", ablauf }, jetzt + ABLAUF_MS), ABLAUF_MS)]);
}

async function callback(config: PortalConfig, request: Request, jetzt: number): Promise<Response> {
  const url = new URL(request.url);
  const gespeichert = pruefen(config.secret, cookieLesen(request, ABLAUF_COOKIE), "ablauf", jetzt);
  const ohneAblauf = [cookieLoeschen(ABLAUF_COOKIE)];
  // Ein Abbruch beim Anmeldedienst (error=access_denied u. a.) oder ein alter, fremder Callback: neu anmelden
  if (url.searchParams.has("error") || !gespeichert || url.searchParams.get("state") !== gespeichert.ablauf.state) {
    return antwort(anmeldeSeite(config.displayName, "Die Anmeldung wurde abgebrochen oder ist abgelaufen. Bitte noch einmal anmelden."), 400, {}, ohneAblauf);
  }
  const code = url.searchParams.get("code");
  if (!code) return antwort(anmeldeSeite(config.displayName, "Die Anmeldung ist nicht möglich."), 400, {}, ohneAblauf);
  const meta = await entdecken(config, jetzt);
  const { sub, gruppen, anzeige } = await abschliessen(config, meta, code, gespeichert.ablauf);
  const firmen = config.firmen.flatMap((firma, i) => (gruppen.includes(firma.gruppe) ? [i] : []));
  const sitzung = signieren(config.secret, { typ: "sitzung", sitzung: { sub, anzeige, firmen, liste: listenAbdruck(config.firmen) } }, jetzt + SITZUNG_MS);
  const cookies = [...ohneAblauf, cookieSetzen(SITZUNG_COOKIE, sitzung, SITZUNG_MS)];
  // Mit genau einer Firma gibt es nichts zu wählen
  return weiter(firmen.length === 1 ? einstieg(config.firmen[firmen[0]!]!.url) : "/", cookies);
}

async function abmelden(config: PortalConfig, jetzt: number): Promise<Response> {
  const cookies = [cookieLoeschen(SITZUNG_COOKIE)];
  // Beim Anmeldedienst endet die Sitzung nur über dessen Abmeldung (RP-Initiated Logout), sonst meldete er sofort wieder an
  const meta = await entdecken(config, jetzt).catch(() => null);
  // Ohne Abmeldung beim Anmeldedienst nicht auf „/“: Das leitete gleich wieder zur Anmeldung
  if (!meta?.endSessionEndpoint) return weiter("/?abgemeldet", cookies);
  const ziel = new URL(meta.endSessionEndpoint);
  ziel.searchParams.set("client_id", config.clientId);
  return weiter(ziel.toString(), cookies);
}

async function route(config: PortalConfig, request: Request, jetzt: number): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/gesund") return new Response("ok", { headers: { "content-type": "text/plain", ...KOPF } });
  if (request.method === "GET" && pathname === "/stil.css")
    return new Response(STIL, { headers: { ...KOPF, "content-type": "text/css; charset=utf-8", "cache-control": "max-age=3600" } });
  const datei = request.method === "GET" ? schrift(pathname) : null;
  if (datei) {
    const inhalt = await datei;
    if (!inhalt) return antwort(fehlerSeite("Nicht gefunden", "Diese Seite gibt es im Portal nicht."), 404);
    return new Response(inhalt, { headers: { ...KOPF, "content-type": "font/woff2", "cache-control": "max-age=86400" } });
  }
  if (request.method === "GET" && pathname === "/") {
    const sitzung = sitzungLesen(config, request, jetzt);
    if (!sitzung) {
      // Das Portal meldet nur per SSO an; ohne eigene Seite davor geht es gleich zum Anmeldedienst
      return url.searchParams.has("abgemeldet") ? antwort(abgemeldetSeite()) : weiter("/anmelden");
    }
    // „Abmelden“ ist ein Formular, das zum end_session_endpoint weiterleitet; form-action gilt in Chromium auch für
    // die Weiterleitung danach, deshalb steht dessen Origin in der CSP dieser Seite
    const meta = await entdecken(config, jetzt).catch(() => null);
    const abmeldeZiel = meta?.endSessionEndpoint ? [new URL(meta.endSessionEndpoint).origin] : [];
    const seite = firmenSeite(sitzung.firmen, url.searchParams.get("suche") ?? "", sitzung.anzeige, einstieg);
    return antwort(seite, 200, { "content-security-policy": csp(abmeldeZiel) });
  }
  if (request.method === "GET" && pathname === "/anmelden") return anmelden(config, jetzt);
  if (request.method === "GET" && pathname === "/callback") return callback(config, request, jetzt);
  if (request.method === "POST" && pathname === "/abmelden") return abmelden(config, jetzt);
  return antwort(fehlerSeite("Nicht gefunden", "Diese Seite gibt es im Portal nicht."), 404);
}

/** Der Request-Handler des Portals; `jetzt` nur für Tests */
export function portal(config: PortalConfig, jetzt: () => number = Date.now): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await route(config, request, jetzt());
    } catch (fehler) {
      if (istAnmeldeFehler(fehler)) {
        console.error(`Portal: ${fehler.ursache}`);
        return antwort(anmeldeSeite(config.displayName, fehler.message), 403, {}, [cookieLoeschen(ABLAUF_COOKIE)]);
      }
      console.error(`Portal: unerwarteter Fehler (${fehler instanceof Error ? fehler.name : "unbekannt"})`);
      return antwort(fehlerSeite("Fehler", "Das Portal konnte die Anfrage nicht bearbeiten."), 500);
    }
  };
}
