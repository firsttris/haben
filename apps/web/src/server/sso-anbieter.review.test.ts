import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideRole } from "./sso-groups.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/*
 * Review PR #479, Anbieterneutralität: Claim-Formen von Keycloak, Authentik, Pocket ID und Entra ID gegen den echten
 * Callback. Der Anbieter ist eine Kopie von sso-test-provider.ts, erweitert um Claims im ID-Token, weggelassene
 * UserInfo-Felder, scopes_supported und einen Issuer mit Pfad. Nur erfundene Identitäten.
 */
interface Identity {
  sub: string;
  email: string;
  /** Claims nur in UserInfo */
  userInfo?: Record<string, unknown>;
  /** Claims nur im ID-Token */
  idToken?: Record<string, unknown>;
  /** UserInfo-Felder, die fehlen */
  omit?: string[];
  accessTokenSeconds?: number;
}

async function startProvider(options: { path?: string; scopesSupported?: string[] } = {}) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const codes = new Map<string, { nonce: string; challenge: string; identity: Identity; scope: string }>();
  const tokens = new Map<string, Record<string, unknown>>();
  let origin = "";
  let issuer = "";
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  const base = () => issuer.replace(/\/$/, "");
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    const path = url.pathname.slice((options.path ?? "").replace(/\/$/, "").length);
    if (path === "/.well-known/openid-configuration")
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${base()}/authorize`,
        token_endpoint: `${base()}/token`,
        jwks_uri: `${base()}/jwks`,
        userinfo_endpoint: `${base()}/userinfo`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        ...(options.scopesSupported ? { scopes_supported: options.scopesSupported } : {}),
      });
    if (path === "/jwks") return json(res, 200, { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k", alg: "RS256", use: "sig" }] });
    if (path === "/userinfo") {
      const profile = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      return profile ? json(res, 200, profile) : json(res, 401, { error: "invalid_token" });
    }
    if (path !== "/token") return json(res, 404, {});
    let body = "";
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    const pending = codes.get(params.get("code") ?? "");
    const verifier = createHash("sha256")
      .update(params.get("code_verifier") ?? "")
      .digest("base64url");
    if (!pending || req.headers.authorization !== `Basic ${Buffer.from("haben:secret").toString("base64")}` || verifier !== pending.challenge)
      return json(res, 400, { error: "invalid_grant" });
    const { identity } = pending;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      aud: "haben",
      azp: "haben",
      sub: identity.sub,
      iat: now,
      exp: now + 3600,
      nonce: pending.nonce,
      email: identity.email,
      email_verified: true,
      ...identity.idToken,
    };
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "k" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const accessToken = randomBytes(16).toString("hex");
    const profile: Record<string, unknown> = { sub: identity.sub, email: identity.email, email_verified: true, name: "Anbieter-Test", ...identity.userInfo };
    for (const key of identity.omit ?? []) delete profile[key];
    tokens.set(accessToken, profile);
    return json(res, 200, {
      access_token: accessToken,
      id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`,
      token_type: "Bearer",
      expires_in: identity.accessTokenSeconds ?? 3600,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  issuer = `${origin}${options.path ?? ""}`;
  return {
    issuer,
    issue(authorizeUrl: URL, identity: Identity) {
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        nonce: authorizeUrl.searchParams.get("nonce")!,
        challenge: authorizeUrl.searchParams.get("code_challenge")!,
        identity,
        scope: authorizeUrl.searchParams.get("scope") ?? "",
      });
      return code;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const cookieOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Keycloak listet in der Discovery seine Client-Scopes; „groups“ gibt es dort nicht (Gruppen kommen über einen Mapper) */
const KEYCLOAK_SCOPES = [
  "openid",
  "acr",
  "address",
  "basic",
  "email",
  "microprofile-jwt",
  "offline_access",
  "organization",
  "phone",
  "profile",
  "roles",
  "web-origins",
];

describe.skipIf(!testDatabaseUrl)("Review: SSO mit anderen Anbietern als Authelia (Postgres)", () => {
  let database: postgres.Sql;
  let provider: Awaited<ReturnType<typeof startProvider>>;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  let client = 1;
  const request = (path: string, body?: unknown, cookie = "") =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-forwarded-for": `127.9.${Math.floor(client / 250)}.${client++ % 250}`,
          ...(body ? { "content-type": "application/json" } : {}),
          cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  async function begin() {
    const response = await request("/sign-in/social", { provider: "oidc", callbackURL: "/" });
    expect(response.status).toBe(200);
    return { url: new URL((await response.json()).url), cookie: cookieOf(response.headers) };
  }
  async function login(identity: Identity) {
    const flow = await begin();
    return request(`/callback/oidc?code=${provider.issue(flow.url, identity)}&state=${flow.url.searchParams.get("state")}`, undefined, flow.cookie);
  }
  const reason = (r: Response) => new URL(r.headers.get("location") ?? "/", "http://localhost").searchParams.get("sso");

  beforeAll(async () => {
    provider = await startProvider({ scopesSupported: KEYCLOAK_SCOPES });
    Object.assign(process.env, {
      OIDC_ONLY: "true",
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: "haben",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_GROUP_INHABER: "haben-inhaber",
      OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
    });
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
    // Einrichtung durch eine Inhaberin in Authelia-Form, damit die übrigen Fälle nicht an der Ersteinrichtung hängen
    const setup = await login({ sub: "setup", email: "setup@example.de", userInfo: { groups: ["haben-inhaber"] } });
    expect(reason(setup)).toBeNull();
  }, 60_000);
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
  });

  // Keycloak: unbekannte Scopes beantwortet der Authorization-Endpunkt mit invalid_scope
  // (https://www.keycloak.org/docs/latest/server_admin/#_client_scopes). Haben fragt „groups“ fest an (oidc.ts).
  it("fragt nur Scopes an, die der Anbieter in scopes_supported nennt (Keycloak)", async () => {
    const { url } = await begin();
    const requested = url.searchParams.get("scope")!.split(" ");
    expect(requested.filter((scope) => !KEYCLOAK_SCOPES.includes(scope))).toEqual([]);
  });

  // Entra ID und Keycloak-Mapper ohne „Add to userinfo“: Gruppen stehen nur im signierten ID-Token
  it("nimmt Gruppen aus dem geprüften ID-Token, wenn UserInfo sie nicht liefert (Entra ID)", async () => {
    const response = await login({ sub: "entra", email: "entra@example.de", idToken: { groups: ["haben-steuerberatung"] } });
    expect(reason(response)).toBeNull();
  });

  // Keycloak: von Admins angelegte Nutzer haben email_verified=false, solange niemand „Email verified“ setzt
  it("lässt eine Identität mit email_verified=false zu; Konten werden ohnehin nie über die E-Mail zusammengeführt (Keycloak)", async () => {
    const response = await login({
      sub: "kc-unverified",
      email: "kc@example.de",
      userInfo: { groups: ["haben-steuerberatung"], email_verified: false },
      idToken: { email_verified: false },
    });
    expect(reason(response)).toBeNull();
  });

  // Keycloak „Group Membership“-Mapper: „Full group path“ ist voreingestellt (https://www.keycloak.org/docs/latest/server_admin/#_protocol-mappers)
  it("weist Keycloak-Gruppenpfade bei Gruppen ohne Schrägstrich ab, mit Schrägstrich in der Konfiguration klappt es", async () => {
    const response = await login({ sub: "kc-pfad", email: "kc-pfad@example.de", userInfo: { groups: ["/haben-steuerberatung"] } });
    expect(reason(response)).toBe("gruppe");
    expect(decideRole({ groups: ["/haben-inhaber"] }, { claim: "groups", inhaber: "/haben-inhaber", steuerberatung: "/haben-steuerberatung" })).toEqual({
      ok: true,
      role: "inhaber",
    });
  });

  // Keycloak und Authentik: Access-Token-Laufzeit 5 Minuten voreingestellt; Pocket ID und Authelia 1 Stunde
  it("kürzt die Frist bei 5 Minuten Access-Token-Laufzeit auf 5 Minuten (Keycloak, Authentik)", async () => {
    const response = await login({ sub: "kurz", email: "kurz@example.de", userInfo: { groups: ["haben-steuerberatung"] }, accessTokenSeconds: 300 });
    expect(reason(response)).toBeNull();
    const [session] = await database`select s.sso_checked_at, s.sso_expires_at from session s join account a on a.user_id = s.user_id
      where a.account_id = ${JSON.stringify([provider.issuer, "kurz"])}`;
    const minutes = (new Date(session!.sso_expires_at).getTime() - new Date(session!.sso_checked_at).getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(4.9);
    expect(minutes).toBeLessThanOrEqual(5);
  });

  // Pocket ID: groups-Scope, Gruppen als Array von Namen in ID-Token und UserInfo (https://pocket-id.org/docs/client-examples)
  it("nimmt Pocket-ID-Claims an (Gruppen in ID-Token und UserInfo)", async () => {
    const groups = ["haben-steuerberatung", "nextcloud"];
    expect(reason(await login({ sub: "pocket", email: "pocket@example.de", userInfo: { groups }, idToken: { groups } }))).toBeNull();
  });
});
