import { APIError, authorizationCodeRequest, getOAuth2Tokens, type GenericEndpointContext } from "better-auth";
import { addOAuthServerContext, getOAuthState } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins";
import { rejectCallback, setCallbackProof } from "./auth-transaction.ts";
import { env } from "./env.ts";
import { decideRole, proofExpiry } from "./sso-groups.ts";
import { ssoOnly } from "./sso-policy.ts";

/*
 * OIDC-Anbieter für den SSO-Modus (Authelia als Referenz). Haben nutzt OIDC nur zur Anmeldung: keine gespeicherten
 * Tokens, kein Hintergrundrefresh. Signatur, Issuer, Audience und Nonce prüft Better Auth gegen die JWKS des Anbieters,
 * bevor getUserInfo läuft; State und PKCE prüft der Callback davor.
 */

const denied = () => new APIError("FORBIDDEN", { message: "Die SSO-Anmeldung ist nicht möglich." });

/** Transport- und JSON-Fehler dürfen weder Providerantworten noch interne Details an Better-Call weiterreichen */
async function guardOidcRequest<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw denied();
  }
}

/** Was die Oberfläche über SSO wissen darf */
export const oidcPublicConfig = () => ({ only: ssoOnly(), name: (ssoOnly() && env().OIDC_DISPLAY_NAME) || "SSO" });

/** Schlüssel einer Identität in account.account_id: immer Issuer und Subject zusammen */
export const identityKey = (issuer: string, subject: string) => JSON.stringify([issuer, subject]);

const loopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
const secureUrl = (url: URL) =>
  !url.username &&
  !url.password &&
  !url.hash &&
  (url.protocol === "https:" || (url.protocol === "http:" && loopback(url) && process.env.NODE_ENV !== "production"));

let discoveryCheck: { issuer: string; expires: number; tokenEndpoint: string; userInfoEndpoint: string } | undefined;

/** Discovery des Issuers, geprüft und eine Minute zwischengespeichert. Ohne UserInfo-Endpunkt gibt es keine Gruppen. */
async function validateDiscovery(): Promise<{ tokenEndpoint: string; userInfoEndpoint: string }> {
  const issuer = env().OIDC_ISSUER!;
  if (discoveryCheck?.issuer === issuer && discoveryCheck.expires > Date.now()) return discoveryCheck;
  const response = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw denied();
  const metadata = await response.json();
  if (
    metadata.issuer !== issuer ||
    typeof metadata.userinfo_endpoint !== "string" ||
    !Array.isArray(metadata.id_token_signing_alg_values_supported) ||
    !metadata.id_token_signing_alg_values_supported.some((alg: string) => ["RS256", "PS256", "ES256", "EdDSA"].includes(alg))
  )
    throw denied();
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint"]) {
    if (!secureUrl(new URL(metadata[key]))) throw denied();
  }
  discoveryCheck = { issuer, expires: Date.now() + 60_000, tokenEndpoint: metadata.token_endpoint, userInfoEndpoint: metadata.userinfo_endpoint };
  return discoveryCheck;
}

/** Claims des schon signaturgeprüften ID-Tokens; Issuer, Audience, azp und Ablauf noch einmal ausdrücklich */
function idTokenClaims(idToken: string, issuer: string, clientId: string): Record<string, unknown> {
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString("utf8"));
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== issuer ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 <= Date.now() ||
    !audiences.includes(clientId) ||
    (audiences.length > 1 && claims.azp !== clientId) ||
    (claims.azp !== undefined && claims.azp !== clientId)
  )
    throw denied();
  return claims;
}

async function fetchUserInfo(endpoint: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw denied();
  const profile = await response.json();
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) throw denied();
  return profile;
}

interface OidcTokens {
  idToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
}

/**
 * Nach dem geprüften ID-Token immer UserInfo abfragen: Authelia liefert die Gruppen nur dort. Das Subject muss exakt
 * übereinstimmen (OIDC Core 5.3.2, https://openid.net/specs/openid-connect-core-1_0.html#UserInfoResponse). Die
 * Gruppenentscheidung landet als Nachweis im Callback; eine Ablehnung gibt null zurück, damit Better Auth abbricht.
 */
async function verifiedUserInfo(tokens: OidcTokens) {
  const config = env();
  const issuer = config.OIDC_ISSUER!;
  const state = await getOAuthState();
  // Ein vor einem Moduswechsel oder für einen anderen Issuer begonnener Vorgang gilt nicht
  if (!ssoOnly() || state?.serverContext?.ssoIssuer !== issuer || !tokens.idToken || !tokens.accessToken) throw denied();
  const claims = idTokenClaims(tokens.idToken, issuer, config.OIDC_CLIENT_ID!);
  const metadata = await validateDiscovery();
  const profile = await fetchUserInfo(metadata.userInfoEndpoint, tokens.accessToken);
  if (profile.sub !== claims.sub) throw denied();
  const subject = claims.sub as string;
  const checkedAt = Date.now();
  const decision = decideRole(profile, {
    claim: config.OIDC_GROUPS_CLAIM,
    inhaber: config.OIDC_GROUP_INHABER!,
    steuerberatung: config.OIDC_GROUP_STEUERBERATUNG!,
  });
  const base = { issuer, subject, accountId: identityKey(issuer, subject), checkedAt: new Date(checkedAt) };
  if (!decision.ok) {
    setCallbackProof({ ...base, rejection: decision.reason });
    rejectCallback("gruppe");
    return null;
  }
  const expiry = proofExpiry(checkedAt, [(claims.exp as number) * 1000, tokens.accessTokenExpiresAt?.getTime()]);
  if (!expiry) throw denied();
  setCallbackProof({ ...base, role: decision.role, expiresAt: new Date(expiry) });
  const email = profile.email ?? claims.email;
  const emailVerified = profile.email_verified ?? claims.email_verified;
  if (emailVerified !== true || typeof email !== "string" || !email) throw denied();
  const name = typeof profile.name === "string" && profile.name ? profile.name : email;
  return { sub: subject, email, emailVerified: true, name };
}

export function oidcProvider() {
  const config = env();
  if (!ssoOnly() || !config.OIDC_ISSUER) return [];
  const issuer = config.OIDC_ISSUER;
  return [
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          name: config.OIDC_DISPLAY_NAME ?? "SSO",
          discoveryUrl: `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
          clientId: config.OIDC_CLIENT_ID!,
          clientSecret: config.OIDC_CLIENT_SECRET!,
          redirectURI: `${new URL(config.BETTER_AUTH_URL).origin}/api/auth/callback/oidc`,
          // groups: Authelia gibt die Gruppen nur mit diesem Scope heraus
          scopes: ["openid", "profile", "email", "groups"],
          pkce: true,
          requireIdTokenVerification: true,
          tokenEndpointAuth: { method: "client_secret_basic" },
          disableProviderLogout: true,
          // Namen und Rechte bestehender Konten kommen nicht aus Profilclaims
          overrideUserInfo: false,
          getToken: ({ code, codeVerifier, redirectURI }) =>
            guardOidcRequest(async () => {
              const metadata = await validateDiscovery();
              const request = await authorizationCodeRequest({
                code,
                codeVerifier,
                redirectURI,
                options: { clientId: config.OIDC_CLIENT_ID!, clientSecret: config.OIDC_CLIENT_SECRET! },
                tokenEndpoint: metadata.tokenEndpoint,
                tokenEndpointAuth: { method: "client_secret_basic" },
              });
              const response = await fetch(metadata.tokenEndpoint, {
                method: "POST",
                headers: request.headers,
                body: request.body,
                signal: AbortSignal.timeout(10_000),
                redirect: "error",
              });
              if (!response.ok) throw denied();
              return getOAuth2Tokens(await response.json());
            }),
          accountSubject: ({ profile }) => identityKey(issuer, String(profile.sub)),
          getUserInfo: (tokens) => guardOidcRequest(() => verifiedUserInfo(tokens)),
        },
      ],
    }),
  ];
}

/** Start und Callback nur mit dem geprüften Anbieter; feste interne Ziele statt Browserangaben */
export async function oidcBefore(ctx: GenericEndpointContext): Promise<void> {
  const callback = ctx.path?.startsWith("/callback/");
  if (!callback && ctx.path !== "/sign-in/social") return;
  await guardOidcRequest(async () => {
    if (!ssoOnly()) throw denied();
    await validateDiscovery();
    const provider = ctx.context.socialProviders.find((p) => p.id === "oidc");
    if (!provider || provider.issuer !== env().OIDC_ISSUER || !provider.idToken || !provider.requiresIdTokenNonce) throw denied();
  });
  if (callback) return;
  if (ctx.body?.provider !== "oidc" || ctx.body?.idToken || ctx.body?.scopes || ctx.body?.additionalParams || ctx.body?.loginHint) throw denied();
  // Auch Fehler- und Neuanlage-URLs fest: keine offenen Redirects. Ob ein Konto entsteht, entscheidet der Callback.
  ctx.body.callbackURL = "/";
  ctx.body.newUserCallbackURL = "/";
  ctx.body.errorCallbackURL = "/login?sso=fehler";
  ctx.body.requestSignUp = true;
  await addOAuthServerContext({ ssoIssuer: env().OIDC_ISSUER });
}

/** Keine langlebigen Provider-Zugangsdaten: gilt beim Anlegen UND Aktualisieren jedes Accounts */
export function withoutProviderTokens<T extends Record<string, unknown>>(account: T): T {
  return { ...account, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };
}
