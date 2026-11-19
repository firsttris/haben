import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/*
 * Kontrollierter OIDC-Anbieter für die Tests auf Loopback: echte RSA-Signaturen, JWKS, PKCE und Basic-Auth am
 * Token-Endpunkt, Gruppen nur über UserInfo wie bei Authelia. Ausschließlich erfundene Identitäten; nie im Betrieb.
 */

export interface TestIdentity {
  sub: string;
  email: string;
  name?: string;
  /** Inhalt des Gruppen-Claims in UserInfo; undefined lässt den Claim weg */
  groups?: unknown;
  /** Zusätzliche oder abweichende UserInfo-Felder, z. B. ein fremdes Subject */
  userInfo?: Record<string, unknown>;
  /** Sekunden bis zum Ablauf des ID-Tokens (Vorgabe 3600) */
  idTokenSeconds?: number;
  /** expires_in des Access-Tokens (Vorgabe 3600) */
  accessTokenSeconds?: number;
  /** Mit einem fremden Schlüssel signieren */
  wrongKey?: boolean;
}

interface PendingCode {
  nonce: string;
  challenge: string;
  identity: TestIdentity;
}

export interface TestProvider {
  issuer: string;
  /** Wie oft UserInfo abgefragt wurde */
  userInfoCalls: () => number;
  /** Hinterlegt einen Code für einen begonnenen Vorgang */
  issue: (authorizeUrl: URL, identity: TestIdentity) => string;
  /** Wie der Discovery-Endpunkt antwortet: normal, mit 503 oder gar nicht */
  setDiscovery: (mode: "ok" | "fehler" | "haengt") => void;
  /** Läuft bei jeder UserInfo-Anfrage, bevor sie beantwortet wird */
  setUserInfoHook: (hook: (() => Promise<void>) | undefined) => void;
  /** Ob die Discovery einen end_session_endpoint (RP-Initiated Logout) nennt; Vorgabe nein */
  setEndSession: (an: boolean) => void;
  /** Überschreibt Felder der Discovery (Issuer, Algorithmen, Endpunkte), undefined setzt zurück */
  setDiscoveryFelder: (felder: Record<string, unknown> | undefined) => void;
  close: () => Promise<void>;
}

const CLIENT = { id: "haben", secret: "secret" };

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

function idToken(pending: PendingCode, issuer: string, key: KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: CLIENT.id,
    sub: pending.identity.sub,
    email: pending.identity.email,
    email_verified: true,
    iat: now,
    exp: now + (pending.identity.idTokenSeconds ?? 3600),
    nonce: pending.nonce,
  };
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}

/** Stand des Anbieters, den die Tests über die Setter ändern */
type State = {
  issuer: string;
  codes: Map<string, PendingCode>;
  accessTokens: Map<string, Record<string, unknown>>;
  userInfoCalls: number;
  discovery: "ok" | "fehler" | "haengt";
  userInfoHook: (() => Promise<void>) | undefined;
  endSession: boolean;
  discoveryFelder: Record<string, unknown>;
  keys: { privateKey: KeyObject; publicKey: KeyObject };
  otherKey: KeyObject;
};

/** Token-Endpunkt: Code einlösen mit PKCE und Basic-Auth, dann ID-Token und Access-Token ausgeben */
async function token(req: IncomingMessage, res: ServerResponse, state: State) {
  let body = "";
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  const code = params.get("code") ?? "";
  const pending = state.codes.get(code);
  state.codes.delete(code);
  const verifier = createHash("sha256")
    .update(params.get("code_verifier") ?? "")
    .digest("base64url");
  if (!pending || req.headers.authorization !== `Basic ${Buffer.from(`${CLIENT.id}:${CLIENT.secret}`).toString("base64")}` || verifier !== pending.challenge) {
    return json(res, 400, { error: "invalid_grant" });
  }
  const accessToken = randomBytes(16).toString("hex");
  const { identity } = pending;
  state.accessTokens.set(accessToken, {
    sub: identity.sub,
    email: identity.email,
    email_verified: true,
    name: identity.name ?? "SSO-Test",
    ...(identity.groups === undefined ? {} : { groups: identity.groups }),
    ...identity.userInfo,
  });
  return json(res, 200, {
    access_token: accessToken,
    refresh_token: "nie-speichern",
    id_token: idToken(pending, state.issuer, identity.wrongKey ? state.otherKey : state.keys.privateKey),
    token_type: "Bearer",
    expires_in: identity.accessTokenSeconds ?? 3600,
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, state: State) {
  const { issuer } = state;
  const url = new URL(req.url!, issuer);
  if (url.pathname === "/.well-known/openid-configuration" && state.discovery === "haengt") return;
  if (url.pathname === "/.well-known/openid-configuration" && state.discovery === "fehler") return json(res, 503, {});
  if (url.pathname === "/.well-known/openid-configuration")
    return json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      scopes_supported: ["openid", "profile", "email", "groups"],
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
      ...(state.endSession ? { end_session_endpoint: `${issuer}/logout` } : {}),
      ...state.discoveryFelder,
    });
  if (url.pathname === "/jwks") return json(res, 200, { keys: [{ ...state.keys.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] });
  if (url.pathname === "/userinfo") {
    state.userInfoCalls++;
    await state.userInfoHook?.();
    const profile = state.accessTokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return profile ? json(res, 200, profile) : json(res, 401, { error: "invalid_token" });
  }
  if (url.pathname !== "/token") return json(res, 404, {});
  return token(req, res, state);
}

export async function startTestProvider(): Promise<TestProvider> {
  const state: State = {
    issuer: "",
    codes: new Map(),
    accessTokens: new Map(),
    userInfoCalls: 0,
    discovery: "ok",
    userInfoHook: undefined,
    endSession: false,
    discoveryFelder: {},
    keys: generateKeyPairSync("rsa", { modulusLength: 2048 }),
    otherKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
  };
  const server: Server = createServer((req, res) => void handle(req, res, state));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    issuer: state.issuer,
    userInfoCalls: () => state.userInfoCalls,
    setDiscovery: (mode) => {
      state.discovery = mode;
    },
    setUserInfoHook: (hook) => {
      state.userInfoHook = hook;
    },
    setEndSession: (an) => {
      state.endSession = an;
    },
    setDiscoveryFelder: (felder) => {
      state.discoveryFelder = felder ?? {};
    },
    issue(authorizeUrl, identity) {
      const code = randomBytes(16).toString("hex");
      state.codes.set(code, { nonce: authorizeUrl.searchParams.get("nonce")!, challenge: authorizeUrl.searchParams.get("code_challenge")!, identity });
      return code;
    },
    // Keep-Alive-Verbindungen des Clients hielten close() sonst offen
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Umgebung für den SSO-Modus mit dem Testanbieter */
export const ssoTestEnv = (issuer: string) => ({
  OIDC_ONLY: "true",
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: CLIENT.id,
  OIDC_CLIENT_SECRET: CLIENT.secret,
  OIDC_GROUP_INHABER: "haben-inhaber",
  OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
});

export const cookieOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
