import { createHash } from "node:crypto";
import { type PortalZeile, portalFirmenFuer } from "@haben/core";
import type { PortalConfig } from "./env.ts";
import { type Begrenzer, begrenzer, clientAdresse } from "./grenze.ts";
import type { LogoDatei } from "./logos.ts";
import { abmeldeAdresse, abschliessen, anmeldeAdresse, entdecken, istAnmeldeFehler } from "./oidc.ts";
import { schrift } from "./schrift.ts";
import { abgemeldetSeite, anmeldeSeite, type FirmaKachel, fehlerSeite, firmenSeite } from "./seiten.ts";
import { farbStil, STIL } from "./stil.ts";
import {
  ABLAUF_COOKIE,
  ABLAUF_MS,
  ABMELDE_COOKIE,
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
 * Das Firmenportal (#504, Stufe 2): Anmeldung per SSO, danach die Firmen, in deren Inhaber-Gruppe die Person ist, als Links
 * auf ihre Instanzen. Keine Datenbank, keine Buchhaltungsdaten, kein Proxy: Die Instanz meldet beim selben
 * Anmeldedienst selbst an.
 */

/**
 * Content Security Policy; `formZiele` sind weitere Origins, zu denen ein Formular (auch per Weiterleitung) führen darf.
 * Bilder nur vom Firmenportal selbst: die Logos der Firmen (#1036)
 */
const csp = (formZiele: string[] = []) =>
  `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action ${["'self'", ...formZiele].join(" ")}; frame-ancestors 'none'; base-uri 'none'`;

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

/**
 * Die Firmen einer gültigen Sitzung und wer angemeldet ist, sonst null (abgelaufen, manipuliert oder andere Liste). Farbe
 * und Logo zählen nicht zur Liste (listenAbdruck): Ändern sie sich, bleibt man angemeldet (#1036).
 */
function sitzungLesen(config: PortalConfig, request: Request, jetzt: number): { firmen: PortalZeile[]; anzeige: string } | null {
  const inhalt = pruefen(config.secret, cookieLesen(request, SITZUNG_COOKIE), "sitzung", jetzt);
  if (!inhalt || inhalt.sitzung.liste !== listenAbdruck(config.firmen)) return null;
  const sichtbar = inhalt.sitzung.firmen.map((i) => config.firmen[i]).filter((f) => f !== undefined);
  const firmen = portalFirmenFuer(
    sichtbar.map((f) => f.gruppe),
    sichtbar,
  );
  return { firmen, anzeige: typeof inhalt.sitzung.anzeige === "string" ? inhalt.sitzung.anzeige : "" };
}

/** Haben verlinkt das Firmenportal mit ?von=haben (ZumFirmenportal): Wer von dort kommt, will die Liste sehen */
const VON_HABEN = "von=haben";
const vonHaben = (url: URL) => url.searchParams.get("von") === "haben";

/** Der nächste Versuch nach einer abgebrochenen oder abgewiesenen Anmeldung: Der Weg aus Haben bleibt erhalten */
function nochmal(config: PortalConfig, request: Request, jetzt: number): string {
  const ablauf = pruefen(config.secret, cookieLesen(request, ABLAUF_COOKIE), "ablauf", jetzt);
  return vonHaben(new URL(request.url)) || ablauf?.liste ? `/anmelden?${VON_HABEN}` : "/anmelden";
}

/**
 * Abmelden nur aus dem Firmenportal selbst: Ein Formular einer fremden Seite löste sonst die Abmeldung beim
 * Anmeldedienst aus, SameSite=Lax hilft nicht, weil sie keine Cookies braucht (RP-Initiated Logout 1.0, 6). Browser
 * senden bei POST Origin, ältere sonst Sec-Fetch-Site; ohne beides (kein Browser) gilt die Anfrage.
 */
function vonHier(config: PortalConfig, request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === config.url;
  const seite = request.headers.get("sec-fetch-site");
  return seite === null || seite === "same-origin" || seite === "none";
}

async function anmelden(config: PortalConfig, url: URL, jetzt: number): Promise<Response> {
  const meta = await entdecken(config, jetzt);
  const { ablauf, adresse } = await anmeldeAdresse(config, meta);
  const inhalt = { typ: "ablauf" as const, ablauf, ...(vonHaben(url) ? { liste: true } : {}) };
  return weiter(adresse, [cookieSetzen(ABLAUF_COOKIE, signieren(config.secret, inhalt, jetzt + ABLAUF_MS), ABLAUF_MS)]);
}

async function callback(config: PortalConfig, request: Request, jetzt: number): Promise<Response> {
  const url = new URL(request.url);
  const gespeichert = pruefen(config.secret, cookieLesen(request, ABLAUF_COOKIE), "ablauf", jetzt);
  const ohneAblauf = [cookieLoeschen(ABLAUF_COOKIE)];
  // Ein Abbruch beim Anmeldedienst (error=access_denied u. a.) oder ein alter, fremder Callback: neu anmelden
  if (url.searchParams.has("error") || !gespeichert || url.searchParams.get("state") !== gespeichert.ablauf.state) {
    const text = "Die Anmeldung wurde abgebrochen oder ist abgelaufen. Bitte noch einmal anmelden.";
    return antwort(anmeldeSeite(config.displayName, text, nochmal(config, request, jetzt)), 400, {}, ohneAblauf);
  }
  if (!url.searchParams.get("code"))
    return antwort(anmeldeSeite(config.displayName, "Die Anmeldung ist nicht möglich.", nochmal(config, request, jetzt)), 400, {}, ohneAblauf);
  const meta = await entdecken(config, jetzt);
  const { sub, gruppen, anzeige, idToken } = await abschliessen(config, meta, url.search, gespeichert.ablauf);
  const firmen = config.firmen.flatMap((firma, i) => (gruppen.includes(firma.gruppe) ? [i] : []));
  const sitzung = signieren(config.secret, { typ: "sitzung", sitzung: { sub, anzeige, firmen, liste: listenAbdruck(config.firmen) } }, jetzt + SITZUNG_MS);
  const cookies = [...ohneAblauf, cookieSetzen(SITZUNG_COOKIE, sitzung, SITZUNG_MS)];
  // Ein Cookie trägt höchstens 4096 Byte; ein größeres ID-Token (viele Gruppen) geht nicht mit, dann ohne id_token_hint
  const abmeldung = signieren(config.secret, { typ: "abmeldung", idToken }, jetzt + SITZUNG_MS);
  // Ohne neues Cookie das alte löschen: Es könnte das ID-Token einer anderen Person aus diesem Browser tragen
  cookies.push(abmeldung.length <= 3_500 ? cookieSetzen(ABMELDE_COOKIE, abmeldung, SITZUNG_MS) : cookieLoeschen(ABMELDE_COOKIE));
  // Mit genau einer Firma gibt es nichts zu wählen, außer man kommt aus Haben: Dann führte das zurück in dieselbe Instanz
  const direkt = firmen.length === 1 && !gespeichert.liste;
  return weiter(direkt ? einstieg(config.firmen[firmen[0]!]!.url) : "/", cookies);
}

async function abmelden(config: PortalConfig, request: Request, jetzt: number): Promise<Response> {
  const cookies = [cookieLoeschen(SITZUNG_COOKIE), cookieLoeschen(ABMELDE_COOKIE)];
  // Beim Anmeldedienst endet die Sitzung nur über dessen Abmeldung (RP-Initiated Logout), sonst meldete er sofort wieder an
  const meta = await entdecken(config, jetzt).catch(() => null);
  // Ohne Abmeldung beim Anmeldedienst nicht auf „/“: Das leitete gleich wieder zur Anmeldung
  if (!meta?.endSessionEndpoint) return weiter("/?abgemeldet", cookies);
  const hinweis = pruefen(config.secret, cookieLesen(request, ABMELDE_COOKIE), "abmeldung", jetzt);
  return weiter(abmeldeAdresse(config, meta, hinweis?.idToken), cookies);
}

/** Logos und Farben der Kacheln (#1036), beim Start einmal aufbereitet */
interface Zeichen {
  logos: ReadonlyMap<string, LogoDatei>;
  /** Stylesheet mit den Farben; leer ohne Farben */
  farben: string;
  /** Adresse des Stylesheets mit Prüfsumme, damit eine neue Farbe gleich gilt; undefined ohne Farben */
  farbenAdresse: string | undefined;
}

function zeichenAus(config: PortalConfig, logos: ReadonlyMap<string, LogoDatei>): Zeichen {
  const farben = farbStil(config.firmen);
  const farbenAdresse = farben ? `/farben.css?v=${createHash("sha256").update(farben).digest("hex").slice(0, 12)}` : undefined;
  return { logos, farben, farbenAdresse };
}

/** Eine Firma, wie die Seite sie zeigt: das Logo als Adresse, nur wenn es geladen ist, sonst der Buchstabe */
const kachelFuer = (zeichen: Zeichen, firma: PortalZeile): FirmaKachel => ({
  name: firma.name,
  url: firma.url,
  farbe: firma.farbe,
  logo: (firma.logo && zeichen.logos.get(firma.logo)?.adresse) || null,
});

/**
 * Ein Logo nur für eine gültige Sitzung, zu deren Firmen es gehört: Ohne Anmeldung kommt niemand an das Logo, wie in
 * der Instanz selbst (/api/kennzeichen)
 */
function logoAntwort(config: PortalConfig, zeichen: Zeichen, request: Request, pfad: string, jetzt: number): Response {
  const sitzung = sitzungLesen(config, request, jetzt);
  const logo = sitzung?.firmen.flatMap((f) => (f.logo ? [zeichen.logos.get(f.logo)] : [])).find((l) => l?.adresse === pfad);
  if (!logo) return antwort(fehlerSeite("Nicht gefunden", "Diese Seite gibt es im Firmenportal nicht."), 404);
  return new Response(logo.daten, { headers: { ...KOPF, "content-type": logo.typ, "cache-control": "private, max-age=31536000, immutable" } });
}

async function route(config: PortalConfig, zeichen: Zeichen, request: Request, jetzt: number): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/gesund") return new Response("ok", { headers: { "content-type": "text/plain", ...KOPF } });
  if (request.method === "GET" && pathname === "/stil.css")
    return new Response(STIL, { headers: { ...KOPF, "content-type": "text/css; charset=utf-8", "cache-control": "max-age=3600" } });
  if (request.method === "GET" && pathname === "/farben.css")
    return new Response(zeichen.farben, { headers: { ...KOPF, "content-type": "text/css; charset=utf-8", "cache-control": "max-age=86400" } });
  if (request.method === "GET" && pathname.startsWith("/zeichen/")) return logoAntwort(config, zeichen, request, pathname, jetzt);
  const datei = request.method === "GET" ? schrift(pathname) : null;
  if (datei) {
    const inhalt = await datei;
    if (!inhalt) return antwort(fehlerSeite("Nicht gefunden", "Diese Seite gibt es im Firmenportal nicht."), 404);
    return new Response(inhalt, { headers: { ...KOPF, "content-type": "font/woff2", "cache-control": "max-age=86400" } });
  }
  if (request.method === "GET" && pathname === "/") {
    const sitzung = sitzungLesen(config, request, jetzt);
    if (!sitzung) {
      // Das Firmenportal meldet nur per SSO an; ohne eigene Seite davor geht es gleich zum Anmeldedienst
      if (url.searchParams.has("abgemeldet")) return antwort(abgemeldetSeite(config.displayName, url.searchParams.get("abgemeldet") === "dienst"));
      return weiter(vonHaben(url) ? `/anmelden?${VON_HABEN}` : "/anmelden");
    }
    // „Abmelden“ ist ein Formular, das zum end_session_endpoint weiterleitet; form-action gilt in Chromium auch für
    // die Weiterleitung danach, deshalb steht dessen Origin in der CSP dieser Seite
    const meta = await entdecken(config, jetzt).catch(() => null);
    const abmeldeZiel = meta?.endSessionEndpoint ? [new URL(meta.endSessionEndpoint).origin] : [];
    const kacheln = sitzung.firmen.map((firma) => kachelFuer(zeichen, firma));
    const seite = firmenSeite(kacheln, url.searchParams.get("suche") ?? "", sitzung.anzeige, einstieg, zeichen.farbenAdresse);
    return antwort(seite, 200, { "content-security-policy": csp(abmeldeZiel) });
  }
  if (request.method === "GET" && pathname === "/anmelden") return anmelden(config, url, jetzt);
  if (request.method === "GET" && pathname === "/callback") return callback(config, request, jetzt);
  if (request.method === "POST" && pathname === "/abmelden") {
    if (!vonHier(config, request)) return antwort(fehlerSeite("Nicht erlaubt", "Abmelden geht nur aus dem Firmenportal selbst."), 403);
    return abmelden(config, request, jetzt);
  }
  return antwort(fehlerSeite("Nicht gefunden", "Diese Seite gibt es im Firmenportal nicht."), 404);
}

/** Die Wege der Anmeldung: Jeder Callback fragt den Token-Endpunkt an, deshalb begrenzt je Client-Adresse (grenze.ts) */
const BEGRENZT = new Set(["/anmelden", "/callback"]);

function zuViele(grenze: Begrenzer, request: Request, verbindung: string | undefined, jetzt: number): Response | null {
  const { pathname } = new URL(request.url);
  if (!BEGRENZT.has(pathname)) return null;
  const ergebnis = grenze(`${pathname} ${clientAdresse(request, verbindung)}`, jetzt);
  if (ergebnis.erlaubt) return null;
  const seite = fehlerSeite("Zu viele Anmeldeversuche", "Von dieser Adresse kamen zu viele Anmeldeversuche. Bitte versuche es in einer Minute noch einmal.");
  return antwort(seite, 429, { "retry-after": String(ergebnis.wiederInSekunden) });
}

/**
 * Der Request-Handler des Firmenportals; `verbindung` ist die Adresse der Verbindung (Bun: server.requestIP), `jetzt`
 * nur für Tests, `logos` die beim Start geladenen Logos (ladeLogos)
 */
export function portal(
  config: PortalConfig,
  jetzt: () => number = Date.now,
  logos: ReadonlyMap<string, LogoDatei> = new Map(),
): (request: Request, verbindung?: string) => Promise<Response> {
  const grenze = begrenzer();
  const zeichen = zeichenAus(config, logos);
  return async (request, verbindung) => {
    const zeit = jetzt();
    try {
      const begrenzt = zuViele(grenze, request, verbindung, zeit);
      if (begrenzt) return begrenzt;
      return await route(config, zeichen, request, zeit);
    } catch (fehler) {
      if (istAnmeldeFehler(fehler)) {
        console.error(`Firmenportal: ${fehler.ursache}`);
        const seite = anmeldeSeite(config.displayName, fehler.message, nochmal(config, request, zeit));
        return antwort(seite, 403, {}, [cookieLoeschen(ABLAUF_COOKIE)]);
      }
      console.error(`Firmenportal: unerwarteter Fehler (${fehler instanceof Error ? fehler.name : "unbekannt"})`);
      return antwort(fehlerSeite("Fehler", "Das Firmenportal konnte die Anfrage nicht bearbeiten."), 500);
    }
  };
}
