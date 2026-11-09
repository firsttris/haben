import { APIError, authorizationCodeRequest, getOAuth2Tokens, type BetterAuthPlugin, type GenericEndpointContext } from "better-auth";
import { addOAuthServerContext, createAuthMiddleware, getOAuthState, isAPIError } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins";
import { beginCallbackWrites, rejectCallback, setCallbackProof } from "./auth-transaction.ts";
import { env } from "./env.ts";
import { decideRole, SSO_PROOF_MS } from "./sso-groups.ts";
import { ssoOnly } from "./sso-policy.ts";

/*
 * OpenID-Connect-Anbieter für den SSO-Modus, anbieterneutral (Referenzintegration: Authelia). Haben nutzt OIDC nur zur Anmeldung: keine gespeicherten
 * Tokens, kein Hintergrundrefresh. Signatur, Issuer, Audience und Nonce prüft Better Auth gegen die JWKS des Anbieters,
 * bevor getUserInfo läuft; State und PKCE prüft der Callback davor.
 */

/** Die Ursache steht im Log (feste Texte, nie Codes, Tokens oder Claims), die Anfrage erfährt nur die Ablehnung */
const denied = (reason?: string) => {
  if (reason) console.error(`SSO: ${reason}`);
  return new APIError("FORBIDDEN", { message: "Die SSO-Anmeldung ist nicht möglich." });
};

/** Transport- und JSON-Fehler dürfen weder Providerantworten noch interne Details an Better-Call weiterreichen */
async function guardOidcRequest<T>(step: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isAPIError(error)) throw error;
    console.error(`SSO: ${step} fehlgeschlagen (${error instanceof Error ? error.name : "unbekannt"})`);
    throw denied();
  }
}

/** Status und OAuth-Fehlercode einer Anbieterantwort fürs Log, ohne weiteren Inhalt der Antwort */
async function providerFailure(endpoint: string, response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const code = typeof body?.error === "string" ? `, ${body.error.replace(/[^\w.-]/g, "").slice(0, 60)}` : "";
  return `${endpoint} antwortete ${response.status}${code}`;
}

/** Name und E-Mail dienen nur der Anzeige, Konten laufen über Issuer und Subject; auch Intranet- und IDN-Adressen zählen */
const validEmail = (value: unknown): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value);

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

let discoveryCheck: { issuer: string; expires: number; tokenEndpoint: string; userInfoEndpoint?: string; scopes: string[] } | undefined;

/** Discovery des Issuers und zulässige Scopes, geprüft und eine Minute zwischengespeichert. */
async function validateDiscovery(): Promise<{ tokenEndpoint: string; userInfoEndpoint?: string; scopes: string[] }> {
  const issuer = env().OIDC_ISSUER!;
  if (discoveryCheck?.issuer === issuer && discoveryCheck.expires > Date.now()) return discoveryCheck;
  const response = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw denied(await providerFailure("Discovery", response));
  const metadata = await response.json();
  if (
    metadata.issuer !== issuer ||
    !Array.isArray(metadata.id_token_signing_alg_values_supported) ||
    !metadata.id_token_signing_alg_values_supported.some((alg: string) => ["RS256", "PS256", "ES256", "EdDSA"].includes(alg))
  )
    throw denied("Discovery: Issuer stimmt nicht exakt mit OIDC_ISSUER überein oder keine unterstützte ID-Token-Signatur");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint"]) {
    if (key === "userinfo_endpoint" && metadata[key] === undefined) continue;
    if (typeof metadata[key] !== "string" || !secureUrl(new URL(metadata[key]))) throw denied(`Discovery: ${key} fehlt oder ist nicht HTTPS`);
  }
  discoveryCheck = {
    issuer,
    expires: Date.now() + 60_000,
    tokenEndpoint: metadata.token_endpoint,
    userInfoEndpoint: metadata.userinfo_endpoint,
    scopes: env().OIDC_SCOPES?.trim().split(/\s+/) ?? [
      "openid",
      "profile",
      "email",
      ...(Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.includes("groups") ? ["groups"] : []),
    ],
  };
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
    throw denied("ID-Token: Issuer, Subject, Audience, azp oder Ablauf passen nicht");
  return claims;
}

async function fetchUserInfo(endpoint: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw denied(await providerFailure("UserInfo", response));
  const profile = await response.json();
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) throw denied("UserInfo ist kein JSON-Objekt");
  return profile;
}

interface OidcTokens {
  idToken?: string;
  accessToken?: string;
}

/**
 * Nach dem geprüften ID-Token UserInfo abfragen, wenn vorhanden; fehlende Gruppen aus dem geprüften ID-Token lesen. Das Subject muss exakt
 * übereinstimmen (OIDC Core 5.3.2, https://openid.net/specs/openid-connect-core-1_0.html#UserInfoResponse). Die
 * Gruppenentscheidung landet als Nachweis im Callback; eine Ablehnung gibt null zurück, damit Better Auth abbricht.
 */
async function verifiedUserInfo(tokens: OidcTokens) {
  const config = env();
  const issuer = config.OIDC_ISSUER!;
  const state = await getOAuthState();
  // Ein vor einem Moduswechsel oder für einen anderen Issuer begonnener Vorgang gilt nicht
  if (!ssoOnly() || state?.serverContext?.ssoIssuer !== issuer) throw denied("Vorgang stammt aus einer anderen Konfiguration");
  if (!tokens.idToken || !tokens.accessToken) throw denied("Token-Antwort ohne ID-Token oder Access-Token");
  const claims = idTokenClaims(tokens.idToken, issuer, config.OIDC_CLIENT_ID!);
  const metadata = await validateDiscovery();
  const profile = metadata.userInfoEndpoint ? await fetchUserInfo(metadata.userInfoEndpoint, tokens.accessToken) : claims;
  if (profile.sub !== claims.sub) throw denied("UserInfo nennt ein anderes Subject als das ID-Token");
  const groupProfile = Object.hasOwn(profile, config.OIDC_GROUPS_CLAIM) ? profile : claims;
  const subject = claims.sub as string;
  const checkedAt = Date.now();
  const decision = decideRole(groupProfile, {
    claim: config.OIDC_GROUPS_CLAIM,
    inhaber: config.OIDC_GROUP_INHABER!,
    steuerberatung: config.OIDC_GROUP_STEUERBERATUNG!,
  });
  const base = { issuer, subject, accountId: identityKey(issuer, subject), checkedAt: new Date(checkedAt) };
  if (!decision.ok) {
    setCallbackProof({ ...base, rejection: decision.reason });
    rejectCallback(decision.reason === "beide" ? "gruppen-doppelt" : "gruppe");
    return null;
  }
  // Die Frist hängt am Prüfzeitpunkt, nicht an Tokens, die Haben nach dem Callback verwirft
  setCallbackProof({ ...base, role: decision.role, expiresAt: new Date(checkedAt + SSO_PROOF_MS) });
  const email = profile.email ?? claims.email;
  const emailVerified = profile.email_verified ?? claims.email_verified;
  if (!validEmail(email)) {
    // Eine vollständig geprüfte Herabstufung muss auch bei ungültigem Profil alte Inhaberrechte entziehen.
    if (decision.role !== "inhaber") setCallbackProof({ ...base, rejection: "profil" });
    rejectCallback("profil");
    return null;
  }
  const name = typeof profile.name === "string" && profile.name ? profile.name : email;
  await beginCallbackWrites();
  return { sub: subject, email, emailVerified: emailVerified === true, name };
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
          pkce: true,
          requireIdTokenVerification: true,
          tokenEndpointAuth: { method: "client_secret_basic" },
          disableProviderLogout: true,
          // Namen und Rechte bestehender Konten kommen nicht aus Profilclaims
          overrideUserInfo: false,
          getToken: ({ code, codeVerifier, redirectURI }) =>
            guardOidcRequest("Token-Austausch", async () => {
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
              if (!response.ok) throw denied(await providerFailure("Token-Endpunkt", response));
              return getOAuth2Tokens(await response.json());
            }),
          accountSubject: ({ profile }) => identityKey(issuer, String(profile.sub)),
          getUserInfo: (tokens) => guardOidcRequest("UserInfo-Abfrage", () => verifiedUserInfo(tokens)),
        },
      ],
    }),
    oidcGuard(),
  ];
}

/**
 * Als Plugin hinter genericOAuth: Better Auth führt hooks.before vor den Plugin-Hooks aus, und erst der Hook von
 * genericOAuth holt eine beim Start gescheiterte Discovery nach. Davor fehlte der Anbieter bis zum nächsten Neustart.
 */
function oidcGuard(): BetterAuthPlugin {
  return { id: "haben-oidc-guard", hooks: { before: [{ matcher: () => true, handler: createAuthMiddleware(oidcBefore) }] } };
}

/** Start und Callback nur mit dem geprüften Anbieter; feste interne Ziele statt Browserangaben */
async function oidcBefore(ctx: GenericEndpointContext): Promise<void> {
  const callback = ctx.path?.startsWith("/callback/");
  if (!callback && ctx.path !== "/sign-in/social") return;
  if (!callback && ctx.body?.scopes) throw denied();
  await guardOidcRequest("Discovery", async () => {
    if (!ssoOnly()) throw denied();
    const metadata = await validateDiscovery();
    const provider = ctx.context.socialProviders.find((p) => p.id === "oidc");
    if (!provider || provider.issuer !== env().OIDC_ISSUER || !provider.idToken || !provider.requiresIdTokenNonce)
      throw denied("Anbieter nicht bereit: Discovery beim Start gescheitert oder ohne Issuer und jwks_uri");
    if (!callback) ctx.body.scopes = metadata.scopes;
  });
  if (callback) return;
  if (ctx.body?.provider !== "oidc" || ctx.body?.idToken || ctx.body?.additionalParams || ctx.body?.additionalData || ctx.body?.loginHint) throw denied();
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
