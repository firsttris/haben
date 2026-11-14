import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { currentTokenOwners, tokenEvent } from "../../token-responsibility.ts";
import { AUTH_METHODS, authenticateClient, findClient, hashSecret, OAuthError, registerClient, type OAuthClient } from "./oauth-clients.ts";
import { mcpEnabled, OAUTH_ACCESS_PREFIX } from "./tokens.ts";

/*
 * OAuth 2.1 für /api/mcp (#96, Stufe 2), damit Haben als Connector in claude.ai läuft: Metadaten (RFC 8414, RFC 9728),
 * Registrierung (RFC 7591, oauth-clients.ts), Autorisierungscode mit PKCE S256 und Refresh-Token mit Rotation.
 *
 * Eine Verbindung ist eine Zeile in mcp_tokens mit oauth_client_id: Aufrufprotokoll, Liste in den Einstellungen, Widerruf,
 * Verantwortliche und der Hauptschalter gelten damit wie für ein selbst angelegtes Token. Die Rechte sind immer nur
 * „haben:lesen“. Codes leben 60 Sekunden im Speicher (ein Prozess, wie das Rate-Limit), Tokens nur als SHA-256 in der Datenbank.
 */

export const OAUTH_SCOPE = "haben:lesen";

const REFRESH_PREFIX = "hbr_";
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_S = 3600;
/** Eine Verbindung bleibt, solange sie innerhalb von 30 Tagen genutzt wird; jede Erneuerung schiebt das Ende hinaus */
const REFRESH_TTL_MS = 30 * 86_400_000;
/** Automatische Ereignisse (Widerruf bei wiederverwendetem Refresh-Token) */
const SYSTEM_ACTOR = "system:oauth";

const baseUrl = () => new URL(env().BETTER_AUTH_URL).origin;
export const mcpResourceUrl = () => `${baseUrl()}/api/mcp`;
export const protectedResourceMetadataUrl = () => `${baseUrl()}/.well-known/oauth-protected-resource`;

/** RFC 9728: wer /api/mcp schützt und welche Rechte es gibt */
export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [baseUrl()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Haben",
  };
}

/** RFC 8414; die Zustimmung ist eine Seite in Haben, die übrigen Endpunkte liegen unter /api/oauth */
export function authorizationServerMetadata() {
  const base = baseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/autorisieren`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/* ---------- Autorisierung ---------- */

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
}

/** Ergebnis der Prüfung: Fehler ohne Rücksprung (Client oder Redirect-URI unbekannt), Fehler mit Rücksprung oder gültig */
export type AuthorizeCheck =
  | { kind: "fehler"; message: string }
  | { kind: "zurueck"; url: string }
  | { kind: "ok"; client: OAuthClient; redirectUri: string; state?: string; codeChallenge: string };

const withQuery = (uri: string, params: Record<string, string | undefined>) => {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
};

const sameResource = (value: string) => value.replace(/\/+$/, "") === mcpResourceUrl();

/**
 * Prüft eine Anfrage an den Autorisierungs-Endpunkt (RFC 6749 4.1.1, OAuth 2.1). Erst wenn Client und Redirect-URI
 * (exakter Vergleich) stimmen, gehen weitere Fehler per Redirect an den Client zurück, sonst nur als Meldung an den Nutzer.
 * Unbekannte Rechte fallen weg; es gibt nur „haben:lesen“.
 */
export async function checkAuthorizeRequest(params: AuthorizeParams): Promise<AuthorizeCheck> {
  const client = params.client_id ? await findClient(params.client_id) : undefined;
  if (!client) return { kind: "fehler", message: "Dieser Client ist in Haben nicht registriert. Bitte die Verbindung im KI-Assistenten neu einrichten." };
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri))
    return { kind: "fehler", message: "Die Rücksprungadresse passt nicht zum registrierten Client." };
  const back = (error: string, description: string) => ({
    kind: "zurueck" as const,
    url: withQuery(redirectUri, { error, error_description: description, state: params.state }),
  });
  if (params.response_type !== "code") return back("unsupported_response_type", "Nur response_type=code.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back("invalid_request", "PKCE mit S256 ist Pflicht.");
  if (!/^[\w-]{43}$/.test(params.code_challenge)) return back("invalid_request", "code_challenge ist ungültig.");
  if (params.resource && !sameResource(params.resource)) return back("invalid_target", "Unbekannte Ressource.");
  return { kind: "ok", client, redirectUri, state: params.state, codeChallenge: params.code_challenge };
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  expiresAt: number;
}

/** Codes nach ihrem Hash; jeder gilt einmal und 60 Sekunden */
const codes = new Map<string, PendingCode>();

export function resetOAuthStateForTests() {
  codes.clear();
  hits.clear();
}

/**
 * Entscheidung des Inhabers auf der Zustimmungsseite. Gibt die Adresse zurück, zu der der Browser weitergeht: mit Code bei
 * Zustimmung, mit access_denied bei Ablehnung.
 */
export async function decideAuthorization(params: AuthorizeParams, userId: string, approve: boolean, now = Date.now()): Promise<string> {
  const check = await checkAuthorizeRequest(params);
  if (check.kind === "fehler") throw new OAuthError("invalid_request", check.message);
  if (check.kind === "zurueck") return check.url;
  if (!approve) return withQuery(check.redirectUri, { error: "access_denied", error_description: "Der Inhaber hat abgelehnt.", state: check.state });
  if (!(await mcpEnabled())) throw new OAuthError("access_denied", "Erst unter Einstellungen → KI-Assistenten und API den Zugang einschalten.");
  for (const [key, pending] of codes) if (pending.expiresAt <= now) codes.delete(key);
  const code = randomBytes(32).toString("base64url");
  codes.set(hashSecret(code), {
    clientId: check.client.id,
    redirectUri: check.redirectUri,
    codeChallenge: check.codeChallenge,
    userId,
    expiresAt: now + CODE_TTL_MS,
  });
  return withQuery(check.redirectUri, { code, state: check.state, iss: baseUrl() });
}

/* ---------- Token-Endpunkt ---------- */

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function issueTokens(now: Date) {
  const access = `${OAUTH_ACCESS_PREFIX}${randomBytes(32).toString("base64url")}`;
  const refresh = `${REFRESH_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    access,
    refresh,
    columns: {
      tokenHash: hashSecret(access),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000),
      refreshHash: hashSecret(refresh),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
    response: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: OAUTH_SCOPE },
  };
}

async function exchangeCode(client: OAuthClient, form: URLSearchParams, now: Date) {
  const code = form.get("code") ?? "";
  const key = hashSecret(code);
  const pending = codes.get(key);
  codes.delete(key);
  const verifier = form.get("code_verifier") ?? "";
  if (
    !pending ||
    pending.expiresAt <= now.getTime() ||
    pending.clientId !== client.id ||
    (form.get("redirect_uri") ?? pending.redirectUri) !== pending.redirectUri ||
    !/^[\w.~-]{43,128}$/.test(verifier) ||
    s256(verifier) !== pending.codeChallenge
  )
    throw new OAuthError("invalid_grant", "Code ungültig, abgelaufen oder schon benutzt.");
  if (!(await currentTokenOwners(db, now)).has(pending.userId)) throw new OAuthError("invalid_grant", "Die Zustimmung gilt nicht mehr.");

  const tokens = issueTokens(now);
  await withActor(pending.userId, async (tx) => {
    const [created] = await tx
      .insert(schema.mcpTokens)
      .values({
        name: client.name,
        oauthClientId: client.id,
        createdBy: pending.userId,
        responsibleId: pending.userId,
        prefix: "OAuth",
        scopes: [OAUTH_SCOPE],
        createdAt: now,
        ...tokens.columns,
      })
      .returning({ id: schema.mcpTokens.id });
    await tokenEvent(tx, pending.userId, "api", created!.id, "verbunden", pending.userId);
  });
  return tokens.response;
}

/**
 * Refresh mit Rotation (OAuth 2.1, 4.3.1): jedes Refresh-Token gilt einmal. Taucht ein schon getauschtes wieder auf, hat
 * jemand es kopiert; dann endet die ganze Verbindung.
 */
async function refresh(client: OAuthClient, form: URLSearchParams, now: Date) {
  const presented = hashSecret(form.get("refresh_token") ?? "");
  const t = schema.mcpTokens;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.refreshHash, presented), eq(t.oauthClientId, client.id)));
  if (!row) {
    const [reused] = await db
      .select({ id: t.id, responsibleId: t.responsibleId })
      .from(t)
      .where(and(eq(t.previousRefreshHash, presented), eq(t.oauthClientId, client.id), isNull(t.revokedAt)));
    if (reused)
      await withActor(SYSTEM_ACTOR, async (tx) => {
        await tx.update(t).set({ revokedAt: now }).where(eq(t.id, reused.id));
        await tokenEvent(tx, SYSTEM_ACTOR, "api", reused.id, "widerrufen (Refresh-Token doppelt benutzt)", reused.responsibleId);
      });
    throw new OAuthError("invalid_grant", "Refresh-Token ungültig.");
  }
  const owners = await currentTokenOwners(db, now);
  if (row.revokedAt || row.disabledAt || row.expiresAt <= now || !row.responsibleId || !owners.has(row.responsibleId))
    throw new OAuthError("invalid_grant", "Die Verbindung gilt nicht mehr.");
  const tokens = issueTokens(now);
  // Nur tauschen, wenn noch niemand anderes mit demselben Refresh-Token schneller war
  const [rotated] = await db
    .update(t)
    .set({ ...tokens.columns, previousRefreshHash: presented })
    .where(and(eq(t.id, row.id), eq(t.refreshHash, presented)))
    .returning({ id: t.id });
  if (!rotated) throw new OAuthError("invalid_grant", "Refresh-Token ungültig.");
  return tokens.response;
}

/* ---------- Rate-Limit je Adresse ---------- */

const hits = new Map<string, number[]>();

/** Gleitendes Fenster im Speicher; die Adresse kommt von Caddy in X-Forwarded-For */
function limited(request: Request, endpoint: string, max: number, windowMs: number, now = Date.now()): boolean {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unbekannt";
  const key = `${endpoint}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((at) => at > now - windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

/* ---------- HTTP ---------- */

/** Öffentliche Endpunkte ohne Cookie: jeder Ursprung darf lesen, Browser-Clients brauchen das für Discovery und Token */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS, ...headers },
  });
}

function oauthError(error: unknown): Response {
  if (error instanceof OAuthError)
    return json({ error: error.code, error_description: error.description }, error.status, error.status === 401 ? { "WWW-Authenticate": "Basic" } : {});
  console.error(`OAuth: unerwarteter Fehler (${error instanceof Error ? error.name : "unbekannt"})`);
  return json({ error: "server_error" }, 500);
}

/** POST /api/oauth/register: 10 je Stunde und Adresse */
export async function handleRegister(request: Request): Promise<Response> {
  try {
    if (limited(request, "register", 10, 3_600_000)) throw new OAuthError("temporarily_unavailable", "Zu viele Registrierungen.", 429);
    if (!(await mcpEnabled())) throw new OAuthError("access_denied", "Der Zugang für KI-Assistenten ist in Haben ausgeschaltet.", 403);
    const body: unknown = await request.json().catch(() => null);
    return json(await registerClient(body), 201);
  } catch (error) {
    return oauthError(error);
  }
}

/** POST /api/oauth/token: 30 je Minute und Adresse; Body als Formular (RFC 6749), JSON wird ebenfalls angenommen */
export async function handleToken(request: Request, now = new Date()): Promise<Response> {
  try {
    if (limited(request, "token", 30, 60_000)) throw new OAuthError("temporarily_unavailable", "Zu viele Anfragen.", 429);
    const form = (request.headers.get("content-type") ?? "").includes("application/json")
      ? new URLSearchParams((await request.json().catch(() => ({}))) as Record<string, string>)
      : new URLSearchParams(await request.text());
    if (!(await mcpEnabled())) throw new OAuthError("invalid_grant", "Der Zugang für KI-Assistenten ist in Haben ausgeschaltet.");
    const client = await authenticateClient(request, form);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return json(await exchangeCode(client, form, now));
    if (grant === "refresh_token") return json(await refresh(client, form, now));
    throw new OAuthError("unsupported_grant_type", "Nur authorization_code und refresh_token.");
  } catch (error) {
    return oauthError(error);
  }
}
