import { gruppenAus } from "@haben/core";
import * as oidc from "openid-client";
import type { PortalConfig } from "./env.ts";

/*
 * OpenID Connect für das Firmenportal: Authorization Code mit PKCE, nur zur Anmeldung. Keine gespeicherten Tokens, kein
 * Refresh. Den Ablauf und die Prüfungen nach OpenID Connect Core 1.0 übernimmt openid-client (zertifiziert von der
 * OpenID Foundation): Discovery mit exaktem Issuer, ID-Token nach 3.1.3.7 (Signatur gegen die JWKS, iss, aud, azp,
 * exp, iat, nonce), state, PKCE mit S256 (RFC 7636), client_secret_basic und UserInfo mit demselben Subject (5.3.2).
 * Darüber hinaus gelten die Regeln von Haben (apps/web/src/server/oidc.ts): mindestens eine Signatur aus RS256, PS256,
 * ES256 oder EdDSA, Endpunkte nur über HTTPS (http nur für localhost außerhalb von production) und die Gruppen wörtlich
 * aus genau einem Claim.
 */

/** Feste Texte für die Seite; die Ursache (fester Text, nie Codes, Tokens oder Claims) nur fürs Log */
export type AnmeldeFehler = Error & { name: "AnmeldeFehler"; ursache: string };

const anmeldeFehler = (ursache: string): AnmeldeFehler =>
  Object.assign(new Error("Die Anmeldung ist nicht möglich."), { name: "AnmeldeFehler" as const, ursache });

export const istAnmeldeFehler = (fehler: unknown): fehler is AnmeldeFehler => fehler instanceof Error && fehler.name === "AnmeldeFehler";

export interface Metadaten {
  client: oidc.Configuration;
  endSessionEndpoint?: string;
  scopes: string[];
}

/** Was zwischen Anmeldung und Callback im signierten Cookie liegt */
export interface Ablauf {
  state: string;
  nonce: string;
  verifier: string;
}

const ALGORITHMEN = ["RS256", "PS256", "ES256", "EdDSA"];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const SEKUNDEN = 10;

const sichereAdresse = (wert: unknown, config: PortalConfig): wert is string => {
  if (typeof wert !== "string" || !URL.canParse(wert)) return false;
  const url = new URL(wert);
  if (url.username || url.password || url.hash) return false;
  return url.protocol === "https:" || (config.httpLoopback && url.protocol === "http:" && LOOPBACK.includes(url.hostname));
};

/** Ursache fürs Log: HTTP-Status oder Fehlercode des Anmeldedienstes, sonst der Code von openid-client; nie Tokens */
function ursacheAus(schritt: string, fehler: unknown): string {
  if (fehler instanceof oidc.ResponseBodyError) return `${schritt} antwortete ${fehler.status}, ${fehler.error.replace(/[^\w.-]/g, "").slice(0, 60)}`;
  const antwort = fehler instanceof Error && fehler.cause instanceof Response ? fehler.cause : undefined;
  if (antwort && !antwort.ok) return `${schritt} antwortete ${antwort.status}`;
  const code = fehler instanceof Error && "code" in fehler && typeof fehler.code === "string" ? fehler.code : "unbekannt";
  return `${schritt}: ${code.replace(/[^\w.-]/g, "").slice(0, 60)}`;
}

let cache: { issuer: string; bis: number; metadaten: Metadaten } | undefined;

/** Discovery des Issuers, geprüft und eine Minute zwischengespeichert */
export async function entdecken(config: PortalConfig, jetzt = Date.now()): Promise<Metadaten> {
  if (cache?.issuer === config.issuer && cache.bis > jetzt) return cache.metadaten;
  const client = await oidc
    .discovery(new URL(config.issuer), config.clientId, undefined, oidc.ClientSecretBasic(config.clientSecret), {
      timeout: SEKUNDEN,
      // http nur für localhost (Tests, lokaler Anmeldedienst); welche Adressen das sind, prüft sichereAdresse unten
      ...(config.httpLoopback ? { execute: [oidc.allowInsecureRequests] } : {}),
    })
    .catch((fehler: unknown) => {
      throw anmeldeFehler(ursacheAus("Discovery", fehler));
    });
  // Die Signatur des ID-Tokens prüft openid-client nur damit: Nach OIDC Core 3.1.3.7, Schritt 6 genügte TLS zum
  // Token-Endpunkt, Haben prüft sie aber immer gegen die JWKS (und über http auf localhost gibt es kein TLS)
  oidc.enableNonRepudiationChecks(client);
  const meta = client.serverMetadata();
  const algorithmen = (meta.id_token_signing_alg_values_supported ?? []).filter((alg) => ALGORITHMEN.includes(alg));
  // openid-client prüft den Issuer bereits exakt; hier nur die Regeln von Haben
  if (meta.issuer !== config.issuer || algorithmen.length === 0) {
    throw anmeldeFehler("Discovery: Issuer stimmt nicht exakt mit OIDC_ISSUER überein oder keine unterstützte ID-Token-Signatur");
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (!sichereAdresse(meta[key], config)) throw anmeldeFehler(`Discovery: ${key} fehlt oder ist nicht HTTPS`);
  }
  for (const key of ["userinfo_endpoint", "end_session_endpoint"] as const) {
    if (meta[key] !== undefined && !sichereAdresse(meta[key], config)) throw anmeldeFehler(`Discovery: ${key} ist nicht HTTPS`);
  }
  const angeboten = meta.scopes_supported ?? [];
  const metadaten: Metadaten = {
    client,
    endSessionEndpoint: meta.end_session_endpoint,
    scopes: config.scopes ?? ["openid", "profile", "email", ...(angeboten.includes("groups") ? ["groups"] : [])],
  };
  cache = { issuer: config.issuer, bis: jetzt + 60_000, metadaten };
  return metadaten;
}

const redirectUri = (config: PortalConfig) => `${config.url}/callback`;

/** Neuer Ablauf mit Zufallswerten und die Adresse beim Anmeldedienst */
export async function anmeldeAdresse(config: PortalConfig, meta: Metadaten): Promise<{ ablauf: Ablauf; adresse: string }> {
  const ablauf: Ablauf = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier() };
  const adresse = oidc.buildAuthorizationUrl(meta.client, {
    redirect_uri: redirectUri(config),
    scope: meta.scopes.join(" "),
    state: ablauf.state,
    nonce: ablauf.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(ablauf.verifier),
    code_challenge_method: "S256",
  });
  return { ablauf, adresse: adresse.toString() };
}

/** Wer angemeldet ist, nur zur Anzeige: E-Mail, sonst Benutzername oder Name, höchstens 100 Zeichen */
function anzeigeAus(...profile: Record<string, unknown>[]): string {
  for (const feld of ["email", "preferred_username", "name"]) {
    const wert = profile.map((p) => p[feld]).find((w): w is string => typeof w === "string" && w.trim() !== "");
    if (wert) return wert.trim().slice(0, 100);
  }
  return "";
}

/**
 * Callback: Code gegen Tokens tauschen, ID-Token prüfen, UserInfo abfragen und die Gruppen der Person liefern.
 * `suche` ist der Query-Teil des Callbacks; die Redirect-URI kommt aus PORTAL_URL, nicht aus der Anfrage (Reverse Proxy).
 */
export async function abschliessen(
  config: PortalConfig,
  meta: Metadaten,
  suche: string,
  ablauf: Ablauf,
): Promise<{ sub: string; gruppen: string[]; anzeige: string; idToken: string }> {
  const tokens = await oidc
    .authorizationCodeGrant(meta.client, new URL(`${redirectUri(config)}${suche}`), {
      pkceCodeVerifier: ablauf.verifier,
      expectedState: ablauf.state,
      expectedNonce: ablauf.nonce,
      idTokenExpected: true,
    })
    .catch((fehler: unknown) => {
      throw anmeldeFehler(ursacheAus("Token-Endpunkt oder ID-Token", fehler));
    });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== "string" || claims.sub === "") throw anmeldeFehler("ID-Token ohne Subject");
  let profil: Record<string, unknown> = claims;
  if (meta.client.serverMetadata().userinfo_endpoint) {
    profil = await oidc.fetchUserInfo(meta.client, tokens.access_token, claims.sub).catch((fehler: unknown) => {
      throw anmeldeFehler(ursacheAus("UserInfo", fehler));
    });
  }
  // Wie Haben: Gruppen aus UserInfo, fehlen sie dort, aus dem geprüften ID-Token
  const gruppen = gruppenAus(Object.hasOwn(profil, config.groupsClaim) ? profil : claims, config.groupsClaim);
  if ("fehler" in gruppen) throw anmeldeFehler(gruppen.fehler === "fehlt" ? "Gruppen-Claim fehlt" : "Gruppen-Claim ist kein Array aus Zeichenketten");
  return { sub: claims.sub, gruppen: gruppen.gruppen, anzeige: anzeigeAus(profil, claims), idToken: tokens.id_token! };
}

/** Der Rückweg nach der Abmeldung beim Anmeldedienst; beim Anmeldedienst als Post-Logout-Redirect-URI eintragen */
export const rueckwegNachAbmeldung = (config: PortalConfig) => `${config.url}/?abgemeldet=dienst`;

/**
 * Abmeldung beim Anmeldedienst nach OpenID Connect RP-Initiated Logout 1.0, 2: client_id (setzt openid-client),
 * post_logout_redirect_uri und, wenn vorhanden, das ID-Token als id_token_hint; damit fragt etwa Keycloak nicht nach
 */
export function abmeldeAdresse(config: PortalConfig, meta: Metadaten, idToken?: string): string {
  return oidc
    .buildEndSessionUrl(meta.client, {
      post_logout_redirect_uri: rueckwegNachAbmeldung(config),
      ...(idToken ? { id_token_hint: idToken } : {}),
    })
    .toString();
}

/** Nur für Tests: Discovery neu laden */
export function cacheLeeren(): void {
  cache = undefined;
}
