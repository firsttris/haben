import { createHash, randomBytes } from "node:crypto";
import { gruppenAus } from "@haben/core";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import type { PortalConfig } from "./env.ts";

/*
 * OpenID Connect für das Portal: Authorization Code mit PKCE, nur zur Anmeldung. Keine gespeicherten Tokens, kein
 * Refresh. Dieselben Prüfungen wie Haben (apps/web/src/server/oidc.ts), ohne Better Auth: Discovery mit exaktem Issuer,
 * ID-Token nach OpenID Connect Core 1.0, 3.1.3.7 (Signatur gegen die JWKS, iss, aud, azp, exp, nonce), UserInfo mit
 * demselben Subject (5.3.2) und die Gruppen wörtlich aus genau einem Claim.
 */

/** Feste Texte für die Seite; die Ursache (fester Text, nie Codes, Tokens oder Claims) nur fürs Log */
export type AnmeldeFehler = Error & { name: "AnmeldeFehler"; ursache: string };

const anmeldeFehler = (ursache: string): AnmeldeFehler =>
  Object.assign(new Error("Die Anmeldung ist nicht möglich."), { name: "AnmeldeFehler" as const, ursache });

export const istAnmeldeFehler = (fehler: unknown): fehler is AnmeldeFehler => fehler instanceof Error && fehler.name === "AnmeldeFehler";

export interface Metadaten {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  userInfoEndpoint?: string;
  endSessionEndpoint?: string;
  scopes: string[];
  algorithmen: string[];
}

/** Was zwischen Anmeldung und Callback im signierten Cookie liegt */
export interface Ablauf {
  state: string;
  nonce: string;
  verifier: string;
}

const ALGORITHMEN = ["RS256", "PS256", "ES256", "EdDSA"];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

const sichereAdresse = (wert: unknown, config: PortalConfig): wert is string => {
  if (typeof wert !== "string" || !URL.canParse(wert)) return false;
  const url = new URL(wert);
  if (url.username || url.password || url.hash) return false;
  return url.protocol === "https:" || (config.httpLoopback && url.protocol === "http:" && LOOPBACK.includes(url.hostname));
};

async function antwortJson(antwort: Response, schritt: string): Promise<Record<string, unknown>> {
  if (!antwort.ok) {
    const body = (await antwort.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? `, ${body.error.replace(/[^\w.-]/g, "").slice(0, 60)}` : "";
    throw anmeldeFehler(`${schritt} antwortete ${antwort.status}${code}`);
  }
  const json = await antwort.json().catch(() => null);
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw anmeldeFehler(`${schritt}: kein JSON-Objekt`);
  return json as Record<string, unknown>;
}

let cache: { issuer: string; bis: number; metadaten: Metadaten } | undefined;

/** Discovery des Issuers, geprüft und eine Minute zwischengespeichert */
export async function entdecken(config: PortalConfig, jetzt = Date.now()): Promise<Metadaten> {
  if (cache?.issuer === config.issuer && cache.bis > jetzt) return cache.metadaten;
  const adresse = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const meta = await antwortJson(await fetch(adresse, { signal: AbortSignal.timeout(10_000), redirect: "error" }), "Discovery");
  const algorithmen = Array.isArray(meta.id_token_signing_alg_values_supported)
    ? meta.id_token_signing_alg_values_supported.filter((alg): alg is string => ALGORITHMEN.includes(alg as string))
    : [];
  if (meta.issuer !== config.issuer || algorithmen.length === 0) {
    throw anmeldeFehler("Discovery: Issuer stimmt nicht exakt mit OIDC_ISSUER überein oder keine unterstützte ID-Token-Signatur");
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (!sichereAdresse(meta[key], config)) throw anmeldeFehler(`Discovery: ${key} fehlt oder ist nicht HTTPS`);
  }
  for (const key of ["userinfo_endpoint", "end_session_endpoint"]) {
    if (meta[key] !== undefined && !sichereAdresse(meta[key], config)) throw anmeldeFehler(`Discovery: ${key} ist nicht HTTPS`);
  }
  const angeboten = Array.isArray(meta.scopes_supported) ? meta.scopes_supported : [];
  const metadaten: Metadaten = {
    authorizationEndpoint: meta.authorization_endpoint as string,
    tokenEndpoint: meta.token_endpoint as string,
    jwksUri: meta.jwks_uri as string,
    userInfoEndpoint: meta.userinfo_endpoint as string | undefined,
    endSessionEndpoint: meta.end_session_endpoint as string | undefined,
    scopes: config.scopes ?? ["openid", "profile", "email", ...(angeboten.includes("groups") ? ["groups"] : [])],
    algorithmen,
  };
  cache = { issuer: config.issuer, bis: jetzt + 60_000, metadaten };
  return metadaten;
}

const redirectUri = (config: PortalConfig) => `${config.url}/callback`;

/** Neuer Ablauf mit Zufallswerten und die Adresse beim Anmeldedienst (PKCE mit S256, RFC 7636) */
export function anmeldeAdresse(config: PortalConfig, meta: Metadaten): { ablauf: Ablauf; adresse: string } {
  const ablauf: Ablauf = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
  };
  const url = new URL(meta.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("scope", meta.scopes.join(" "));
  url.searchParams.set("state", ablauf.state);
  url.searchParams.set("nonce", ablauf.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(ablauf.verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return { ablauf, adresse: url.toString() };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri), { timeoutDuration: 10_000 });
    jwksCache.set(uri, set);
  }
  return set;
}

/** Signatur, iss, aud und exp prüft jose; azp und nonce hier (OIDC Core 3.1.3.7, Schritte 4, 5 und 11) */
async function idTokenPruefen(idToken: string, config: PortalConfig, meta: Metadaten, nonce: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwks(meta.jwksUri), {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: meta.algorithmen,
    requiredClaims: ["sub", "exp", "iat"],
  }).catch(() => {
    throw anmeldeFehler("ID-Token: Signatur, Issuer, Audience oder Ablauf passen nicht");
  });
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if ((audiences.length > 1 && payload.azp !== config.clientId) || (payload.azp !== undefined && payload.azp !== config.clientId)) {
    throw anmeldeFehler("ID-Token: azp passt nicht");
  }
  if (payload.nonce !== nonce) throw anmeldeFehler("ID-Token: Nonce passt nicht");
  if (typeof payload.sub !== "string" || payload.sub === "") throw anmeldeFehler("ID-Token ohne Subject");
  return payload;
}

/** Client-Authentifizierung client_secret_basic: beide Teile form-kodiert, dann Base64 (RFC 6749, 2.3.1) */
const basic = (config: PortalConfig) => {
  const kodiert = (wert: string) => encodeURIComponent(wert).replace(/%20/g, "+");
  return `Basic ${Buffer.from(`${kodiert(config.clientId)}:${kodiert(config.clientSecret)}`).toString("base64")}`;
};

/**
 * Callback: Code gegen Tokens tauschen, ID-Token prüfen, UserInfo abfragen und die Gruppen der Person liefern. State
 * vergleicht der Aufrufer vorher mit dem Cookie.
 */
/** Wer angemeldet ist, nur zur Anzeige: E-Mail, sonst Benutzername oder Name, höchstens 100 Zeichen */
function anzeigeAus(...profile: Record<string, unknown>[]): string {
  for (const feld of ["email", "preferred_username", "name"]) {
    const wert = profile.map((p) => p[feld]).find((w): w is string => typeof w === "string" && w.trim() !== "");
    if (wert) return wert.trim().slice(0, 100);
  }
  return "";
}

export async function abschliessen(
  config: PortalConfig,
  meta: Metadaten,
  code: string,
  ablauf: Ablauf,
): Promise<{ sub: string; gruppen: string[]; anzeige: string }> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(config), code_verifier: ablauf.verifier });
  const tokens = await antwortJson(
    await fetch(meta.tokenEndpoint, {
      method: "POST",
      headers: { authorization: basic(config), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }),
    "Token-Endpunkt",
  );
  if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string") throw anmeldeFehler("Token-Antwort ohne ID-Token oder Access-Token");
  const claims = await idTokenPruefen(tokens.id_token, config, meta, ablauf.nonce);
  let profil: Record<string, unknown> = claims;
  if (meta.userInfoEndpoint) {
    profil = await antwortJson(
      await fetch(meta.userInfoEndpoint, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      }),
      "UserInfo",
    );
    if (profil.sub !== claims.sub) throw anmeldeFehler("UserInfo nennt ein anderes Subject als das ID-Token");
  }
  // Wie Haben: Gruppen aus UserInfo, fehlen sie dort, aus dem geprüften ID-Token
  const gruppen = gruppenAus(Object.hasOwn(profil, config.groupsClaim) ? profil : claims, config.groupsClaim);
  if ("fehler" in gruppen) throw anmeldeFehler(gruppen.fehler === "fehlt" ? "Gruppen-Claim fehlt" : "Gruppen-Claim ist kein Array aus Zeichenketten");
  return { sub: claims.sub as string, gruppen: gruppen.gruppen, anzeige: anzeigeAus(profil, claims) };
}

/** Nur für Tests: Discovery und JWKS neu laden */
export function cacheLeeren(): void {
  cache = undefined;
  jwksCache.clear();
}
