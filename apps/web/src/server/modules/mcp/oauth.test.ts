import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { allowedRedirectUri } from "./oauth-redirect.ts";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

describe("Redirect-URIs bei der Registrierung", () => {
  it("nimmt nur Claude per https und Loopback per http", () => {
    for (const uri of [CLAUDE, "https://claude.com/api/mcp/auth_callback", "http://127.0.0.1:33418/callback", "http://localhost:6274/oauth/callback"])
      expect(allowedRedirectUri(uri), uri).toBe(true);
    for (const uri of [
      "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai.evil.example/cb",
      "https://evil.example/cb",
      "https://claude.ai:8443/cb",
      "https://user:pw@claude.ai/cb",
      "https://claude.ai/cb#frag",
      "http://192.168.1.5/cb",
      "javascript:alert(1)",
      "kein uri",
    ])
      expect(allowedRedirectUri(uri), uri).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)("OAuth für Connectors (Postgres)", () => {
  let mcp: typeof import("./index.ts");
  let server: typeof import("./server.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let ip = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    mcp = await import("./index.ts");
    server = await import("./server.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    server.resetRateLimitForTests();
    mcp.resetOAuthStateForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, mcp_oauth_clients, token_events, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '77815', 'Bühl', '35/123/45678', 'BW')`;
    await mcp.setMcpEnabled(actor, true);
  });

  /** Jede Anfrage von einer eigenen Adresse, damit das Rate-Limit nur greift, wo es geprüft wird */
  const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": `10.0.0.${++ip % 250}`, ...extra });

  async function register(body: Record<string, unknown>, from = headers()) {
    const response = await mcp.handleRegister(
      new Request("http://localhost:3000/api/oauth/register", {
        method: "POST",
        headers: { ...from, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  }

  function token(form: Record<string, string>, extra: Record<string, string> = {}, now?: Date) {
    return mcp
      .handleToken(
        new Request("http://localhost:3000/api/oauth/token", {
          method: "POST",
          headers: headers({ "Content-Type": "application/x-www-form-urlencoded", ...extra }),
          body: new URLSearchParams(form).toString(),
        }),
        now,
      )
      .then(async (response) => ({ status: response.status, body: (await response.json()) as Record<string, string | number> }));
  }

  function rpc(bearer: string) {
    return server.handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
  }

  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };

  /** Zustimmung des Inhabers; gibt den Code aus dem Rücksprung zurück */
  async function approve(clientId: string, challenge: string, state = "xyz") {
    const url = new URL(
      await mcp.decideAuthorization(
        { response_type: "code", client_id: clientId, redirect_uri: CLAUDE, state, code_challenge: challenge, code_challenge_method: "S256" },
        actor,
        true,
      ),
    );
    expect(url.origin + url.pathname).toBe(CLAUDE);
    expect(url.searchParams.get("state")).toBe(state);
    return url.searchParams.get("code")!;
  }

  async function connect() {
    const { body: client } = await register({ redirect_uris: [CLAUDE], client_name: "Claude", token_endpoint_auth_method: "none" });
    const { verifier, challenge } = pkce();
    const code = await approve(client.client_id!, challenge);
    const issued = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id!, redirect_uri: CLAUDE });
    expect(issued.status).toBe(200);
    return { clientId: client.client_id!, ...(issued.body as { access_token: string; refresh_token: string }) };
  }

  it("zeigt bei 401 auf die Metadaten; diese beschreiben Ressource und Autorisierungsserver", async () => {
    const response = await rpc("hb_unbekannt");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"');
    expect(mcp.protectedResourceMetadata()).toMatchObject({ resource: "http://localhost:3000/api/mcp", authorization_servers: ["http://localhost:3000"] });
    expect(mcp.authorizationServerMetadata()).toMatchObject({
      issuer: "http://localhost:3000",
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: "http://localhost:3000/api/oauth/register",
    });
  });

  it("registriert Clients nur mit erlaubten Redirect-URIs und nur bei eingeschaltetem Zugang", async () => {
    const ok = await register({ redirect_uris: [CLAUDE], client_name: "Claude" });
    expect(ok.status).toBe(201);
    // Vorgabe nach RFC 7591 ist client_secret_basic: Secret nur in der Antwort, gespeichert der Hash
    expect(ok.body.client_secret).toBeTruthy();
    const [row] = await sql`select secret_hash, name from mcp_oauth_clients`;
    expect(row!.secret_hash).not.toBe(ok.body.client_secret);
    expect(row!.name).toBe("Claude");

    expect((await register({ redirect_uris: ["https://evil.example/cb"] })).body.error).toBe("invalid_redirect_uri");
    expect((await register({})).body.error).toBe("invalid_client_metadata");
    await mcp.setMcpEnabled(actor, false);
    expect((await register({ redirect_uris: [CLAUDE] })).status).toBe(403);
  });

  it("begrenzt Registrierungen je Adresse", async () => {
    const from = headers();
    for (let i = 0; i < 10; i++) expect((await register({ redirect_uris: [CLAUDE] }, from)).status).toBe(201);
    expect((await register({ redirect_uris: [CLAUDE] }, from)).status).toBe(429);
  });

  it("prüft die Autorisierungsanfrage: ohne gültigen Client keine Weiterleitung, sonst Fehler mit state zurück", async () => {
    const { body: client } = await register({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" });
    const base = {
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      state: "s1",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
    };
    expect((await mcp.checkAuthorizeRequest({ ...base, client_id: "unbekannt" })).kind).toBe("fehler");
    expect((await mcp.checkAuthorizeRequest({ ...base, redirect_uri: "https://claude.ai/anders" })).kind).toBe("fehler");
    const plain = await mcp.checkAuthorizeRequest({ ...base, code_challenge_method: "plain" });
    expect(plain.kind).toBe("zurueck");
    if (plain.kind === "zurueck") {
      expect(new URL(plain.url).searchParams.get("error")).toBe("invalid_request");
      expect(new URL(plain.url).searchParams.get("state")).toBe("s1");
    }
    const target = await mcp.checkAuthorizeRequest({ ...base, resource: "https://andere.example/api/mcp" });
    expect(target.kind === "zurueck" && new URL(target.url).searchParams.get("error")).toBe("invalid_target");
    expect((await mcp.checkAuthorizeRequest({ ...base, resource: "http://localhost:3000/api/mcp" })).kind).toBe("ok");

    const denied = new URL(await mcp.decideAuthorization(base, actor, false));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("code")).toBeNull();
  });

  it("tauscht einen Code genau einmal und nur mit passendem PKCE-Verifier", async () => {
    const { body: client } = await register({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" });
    const { verifier, challenge } = pkce();
    const code = await approve(client.client_id!, challenge);
    const wrong = await token({ grant_type: "authorization_code", code, code_verifier: pkce().verifier, client_id: client.client_id! });
    expect(wrong.body.error).toBe("invalid_grant");
    // Der Fehlversuch hat den Code verbraucht
    expect((await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id! })).body.error).toBe("invalid_grant");

    const fresh = await approve(client.client_id!, challenge);
    const ok = await token({ grant_type: "authorization_code", code: fresh, code_verifier: verifier, client_id: client.client_id! });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "haben:lesen" });
    expect((await token({ grant_type: "authorization_code", code: fresh, code_verifier: verifier, client_id: client.client_id! })).body.error).toBe(
      "invalid_grant",
    );
  });

  it("lässt einen Code nach 60 Sekunden verfallen", async () => {
    const { body: client } = await register({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" });
    const { verifier, challenge } = pkce();
    const code = await approve(client.client_id!, challenge);
    const late = await token(
      { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id! },
      {},
      new Date(Date.now() + 61_000),
    );
    expect(late.body.error).toBe("invalid_grant");
  });

  it("gibt mit dem Access-Token nur lesende Werkzeuge, eine Stunde lang, und listet die Verbindung wie ein Token", async () => {
    const { access_token } = await connect();
    expect(access_token).toMatch(/^hba_/);
    expect((await rpc(access_token)).status).toBe(200);
    const [listed] = await mcp.listMcpTokens();
    expect(listed).toMatchObject({ name: "Claude", oauth: true, status: "aktiv", scopes: ["haben:lesen"] });
    const [stored] = await sql`select token_hash, refresh_hash from mcp_tokens`;
    expect(JSON.stringify(stored)).not.toContain(access_token);
    expect(
      await mcp.authenticateMcp(new Request("http://x", { headers: { Authorization: `Bearer ${access_token}` } }), new Date(Date.now() + 3601_000)),
    ).toBeNull();
    const [event] = await sql`select action, actor from token_events`;
    expect(event).toMatchObject({ action: "verbunden", actor });
  });

  it("rotiert das Refresh-Token und beendet die Verbindung, wenn ein altes wiederkommt", async () => {
    const first = await connect();
    const second = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect((await rpc(String(second.body.access_token))).status).toBe(200);
    expect((await rpc(first.access_token)).status).toBe(401);

    const replay = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
    expect(replay.body.error).toBe("invalid_grant");
    expect((await rpc(String(second.body.access_token))).status).toBe(401);
    expect((await mcp.listMcpTokens())[0]!.status).toBe("widerrufen");
    expect((await token({ grant_type: "refresh_token", refresh_token: String(second.body.refresh_token), client_id: first.clientId })).body.error).toBe(
      "invalid_grant",
    );
  });

  it("widerrufen in den Einstellungen sperrt Access- und Refresh-Token", async () => {
    const connection = await connect();
    await mcp.revokeMcpToken(actor, (await mcp.listMcpTokens())[0]!.id);
    expect((await rpc(connection.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", refresh_token: connection.refresh_token, client_id: connection.clientId })).body.error).toBe(
      "invalid_grant",
    );
  });

  it("verlangt von einem Client mit Secret die Anmeldung per Basic oder im Body", async () => {
    const { body: client } = await register({ redirect_uris: [CLAUDE], client_name: "Claude" });
    const { verifier, challenge } = pkce();
    const form = (code: string) => ({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CLAUDE });
    const without = await token({ ...form(await approve(client.client_id!, challenge)), client_id: client.client_id! });
    expect(without.status).toBe(401);
    expect(without.body.error).toBe("invalid_client");
    const basic = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`;
    expect((await token(form(await approve(client.client_id!, challenge)), { Authorization: basic })).status).toBe(200);
    expect(
      (await token({ ...form(await approve(client.client_id!, challenge)), client_id: client.client_id!, client_secret: client.client_secret! })).status,
    ).toBe(200);
  });

  it("gibt bei ausgeschaltetem Zugang keine Tokens und lässt bestehende nicht mehr zu", async () => {
    const connection = await connect();
    await mcp.setMcpEnabled(actor, false);
    expect((await rpc(connection.access_token)).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", refresh_token: connection.refresh_token, client_id: connection.clientId })).status).toBe(400);
  });
});
