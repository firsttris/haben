import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PortalFirma } from "@haben/core";
import type { Ablauf } from "./oidc.ts";

/*
 * Zustandslose Sitzung des Portals: Es gibt keine Datenbank, deshalb liegt alles in Cookies, die mit PORTAL_SECRET
 * signiert sind (HMAC-SHA-256). Der Ablauf (state, nonce, PKCE-Verifier) gilt zehn Minuten, die Sitzung 15 Minuten wie
 * eine Berechtigung in Haben (SSO_PROOF_MS); danach meldet der Anmeldedienst erneut an, meist ohne Rückfrage.
 */

export const ABLAUF_COOKIE = "__Host-haben-portal-ablauf";
export const SITZUNG_COOKIE = "__Host-haben-portal";
export const ABLAUF_MS = 10 * 60_000;
export const SITZUNG_MS = 15 * 60_000;

interface Sitzung {
  sub: string;
  /** E-Mail oder Name aus dem Profil, nur für „Angemeldet als“ */
  anzeige: string;
  /** Stellen der Firmen in PORTAL_FIRMEN, die die Person sieht; 50 Adressen passten nicht sicher in ein Cookie */
  firmen: number[];
  /** Fingerabdruck von PORTAL_FIRMEN: Ändert sich die Liste, gelten die Stellen nicht mehr */
  liste: string;
}

type Inhalt = { typ: "ablauf"; ablauf: Ablauf } | { typ: "sitzung"; sitzung: Sitzung };

const signatur = (secret: string, wert: string) => createHmac("sha256", secret).update(wert).digest("base64url");

/** Signierter Wert mit Ablaufzeit: base64url(JSON).signatur */
export function signieren(secret: string, inhalt: Inhalt, bis: number): string {
  const wert = Buffer.from(JSON.stringify({ ...inhalt, bis })).toString("base64url");
  return `${wert}.${signatur(secret, wert)}`;
}

/** Der Inhalt, wenn Signatur, Typ und Ablaufzeit stimmen, sonst null */
export function pruefen<T extends Inhalt["typ"]>(secret: string, cookie: string | undefined, typ: T, jetzt: number): Extract<Inhalt, { typ: T }> | null {
  if (!cookie) return null;
  const [wert, sig, ...rest] = cookie.split(".");
  if (!wert || !sig || rest.length > 0) return null;
  const erwartet = Buffer.from(signatur(secret, wert));
  const erhalten = Buffer.from(sig);
  if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) return null;
  try {
    const inhalt = JSON.parse(Buffer.from(wert, "base64url").toString("utf8")) as Inhalt & { bis: unknown };
    if (inhalt.typ !== typ || typeof inhalt.bis !== "number" || inhalt.bis <= jetzt) return null;
    return inhalt as unknown as Extract<Inhalt, { typ: T }>;
  } catch {
    return null;
  }
}

/** Fingerabdruck der Liste: Name, Adresse und Gruppe jeder Firma in ihrer Reihenfolge */
export const listenAbdruck = (firmen: readonly PortalFirma[]) =>
  createHash("sha256")
    .update(JSON.stringify(firmen.map((f) => [f.name, f.url, f.gruppe])))
    .digest("base64url")
    .slice(0, 16);

export function cookieLesen(request: Request, name: string): string | undefined {
  for (const teil of (request.headers.get("cookie") ?? "").split(";")) {
    const [schluessel, ...wert] = teil.trim().split("=");
    if (schluessel === name) return wert.join("=");
  }
  return undefined;
}

/** __Host-: nur über HTTPS (oder localhost), nur für genau diesen Host, Pfad / */
export function cookieSetzen(name: string, wert: string, maxAgeMs: number): string {
  return `${name}=${wert}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export const cookieLoeschen = (name: string) => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
