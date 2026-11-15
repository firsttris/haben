import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Wer darf den OAuth-Weg benutzen (#96): Ausgeschaltet gibt es ihn nicht (404 auf jedem Endpunkt), und Zulassen geht nur
 * mit frischer Anmeldung des Inhabers.
 */

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

describe.skipIf(!testDatabaseUrl)("Zugang zum OAuth-Weg (Postgres)", () => {
  let mcp: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let ip = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    mcp = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    mcp.resetOAuthStateForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, mcp_oauth_clients, token_events, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '77815', 'Bühl', '35/123/45678', 'BW')`;
    await mcp.setMcpEnabled(actor, true);
  });

  const post = (path: string, body: string, contentType: string) =>
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "x-forwarded-for": `10.1.0.${++ip % 250}`, "Content-Type": contentType },
      body,
    });

  /** Jeder öffentliche Endpunkt mit der Antwort, die er gerade gibt */
  async function endpoints(): Promise<Record<string, number>> {
    const register = post("/api/oauth/register", JSON.stringify({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" }), "application/json");
    const token = post("/api/oauth/token", "grant_type=refresh_token&refresh_token=hbr_x&client_id=x", "application/x-www-form-urlencoded");
    return {
      "/.well-known/oauth-protected-resource": (await mcp.handleMetadata("resource")).status,
      "/.well-known/oauth-protected-resource/api/mcp": (await mcp.handleMetadata("resource", "api/mcp")).status,
      "/.well-known/oauth-authorization-server": (await mcp.handleMetadata("server")).status,
      "OPTIONS (CORS)": (await mcp.handlePreflight()).status,
      "/api/oauth/register": (await mcp.handleRegister(register)).status,
      "/api/oauth/token": (await mcp.handleToken(token)).status,
    };
  }

  const authorizeParams = (clientId: string) => ({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE,
    state: "s",
    code_challenge: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url"),
    code_challenge_method: "S256",
  });

  it("antwortet eingeschaltet wie beschrieben", async () => {
    expect(await endpoints()).toEqual({
      "/.well-known/oauth-protected-resource": 200,
      "/.well-known/oauth-protected-resource/api/mcp": 200,
      "/.well-known/oauth-authorization-server": 200,
      "OPTIONS (CORS)": 204,
      "/api/oauth/register": 201,
      "/api/oauth/token": 401,
    });
    expect((await mcp.handleMetadata("resource", "anders")).status).toBe(404);
    expect(await mcp.oauthAvailable()).toBe(true);
  });

  it("liefert ausgeschaltet auf jedem Endpunkt 404, und die Zustimmungsseite gibt es nicht", async () => {
    const client = (await (await mcp.handleRegister(post("/api/oauth/register", JSON.stringify({ redirect_uris: [CLAUDE] }), "application/json"))).json()) as {
      client_id: string;
    };
    await mcp.setMcpEnabled(actor, false);
    const statuses = await endpoints();
    expect(Object.entries(statuses).filter(([, status]) => status !== 404)).toEqual([]);
    expect(await mcp.oauthAvailable()).toBe(false);
    // Auch eine Anfrage, die vor dem Ausschalten gültig war, kommt nicht mehr bis zur Zustimmung
    const check = await mcp.checkAuthorizeRequest(authorizeParams(client.client_id));
    expect(check.kind).toBe("fehler");
    await expect(mcp.decideAuthorization(authorizeParams(client.client_id), { id: actor, signedInAt: new Date() }, false)).rejects.toThrow(/nicht verfügbar/);
  });

  it("lässt nur mit frischer Anmeldung zu; Ablehnen geht immer", async () => {
    const client = (await (await mcp.handleRegister(post("/api/oauth/register", JSON.stringify({ redirect_uris: [CLAUDE] }), "application/json"))).json()) as {
      client_id: string;
    };
    const now = Date.now();
    const vor = (minuten: number) => ({ id: actor, signedInAt: new Date(now - minuten * 60_000) });
    expect(mcp.freshLogin(vor(4).signedInAt, now)).toBe(true);
    expect(mcp.freshLogin(vor(6).signedInAt, now)).toBe(false);

    await expect(mcp.decideAuthorization(authorizeParams(client.client_id), vor(6), true, now)).rejects.toThrow(/erneut anmelden/);
    const denied = new URL(await mcp.decideAuthorization(authorizeParams(client.client_id), vor(60), false, now));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    const approved = new URL(await mcp.decideAuthorization(authorizeParams(client.client_id), vor(4), true, now));
    expect(approved.searchParams.get("code")).toBeTruthy();
  });
});
