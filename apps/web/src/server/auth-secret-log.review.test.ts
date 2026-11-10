import { format } from "node:util";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";
import { cookieOf, ssoTestEnv, startTestProvider, type TestProvider } from "./sso-test-provider.ts";

describe.skipIf(!testDatabaseUrl)("Auth-Fehler ohne Geheimnisse im Log (Review)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  const request = (path: string, cookie = "", body?: unknown) =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: { origin: "http://localhost:3000", cookie, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  beforeAll(async () => {
    provider = await startTestProvider();
    Object.assign(process.env, ssoTestEnv(provider.issuer));
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
  }, 60_000);
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
  });
  it("schreibt bei einem DB-Fehler beim Abmelden keinen weiterhin gültigen Sessiontoken nach stderr", async () => {
    const started = await request("/sign-in/social", "", { provider: "oidc" });
    const url = new URL((await started.json()).url);
    const code = provider.issue(url, { sub: "owner", email: "owner@example.de", groups: ["haben-inhaber"] });
    const loggedIn = await request(`/callback/oidc?code=${code}&state=${url.searchParams.get("state")}`, cookieOf(started.headers));
    const cookie = cookieOf(loggedIn.headers);
    expect((await request("/get-session", cookie)).status).toBe(200);
    const [session] = await database`select token from session limit 1`;
    const messages: string[] = [];
    const stderr = vi.spyOn(console, "error").mockImplementation((...args) => {
      messages.push(format(...args));
    });
    // Fehlgeschlagene Löschung lässt den vorhandenen Zugang gültig.
    await database`create function review_fail_logout() returns trigger language plpgsql as $$ begin raise exception 'DB nicht verfügbar'; end $$`;
    await database`create trigger review_fail_logout before delete on session for each row execute function review_fail_logout()`;
    try {
      await request("/sign-out", cookie, {});
    } finally {
      await database`drop trigger review_fail_logout on session`;
      await database`drop function review_fail_logout()`;
      stderr.mockRestore();
    }
    expect((await request("/get-session", cookie)).status).toBe(200);
    expect(messages.join("\n")).not.toContain(session!.token);
  });
  it("schreibt bei einem DB-Fehler im Callback keine INSERT-Parameter der neuen Sitzung nach stderr", async () => {
    const started = await request("/sign-in/social", "", { provider: "oidc" });
    const url = new URL((await started.json()).url);
    const code = provider.issue(url, { sub: "db-error", email: "db-error@example.de", groups: ["haben-inhaber"] });
    await database`create function review_fail_session() returns trigger language plpgsql as $$ begin raise exception 'Testfehler'; end $$`;
    await database`create trigger review_fail_session before insert on session for each row execute function review_fail_session()`;
    const messages: string[] = [];
    const stderr = vi.spyOn(console, "error").mockImplementation((...args) => {
      messages.push(format(...args));
    });
    try {
      const response = await request(`/callback/oidc?code=${code}&state=${url.searchParams.get("state")}`, cookieOf(started.headers));
      expect(response.headers.get("location")).toContain("sso=fehler");
    } finally {
      await database`drop trigger review_fail_session on session`;
      await database`drop function review_fail_session()`;
      stderr.mockRestore();
    }
    expect(messages.join("\n")).not.toMatch(/insert into "session"[\s\S]*params:/);
  });
  it("entwertet den verbrauchten OAuth-State auch bei geworfenem Datenbankfehler im Callback", async () => {
    const started = await request("/sign-in/social", "", { provider: "oidc" });
    const url = new URL((await started.json()).url);
    const state = url.searchParams.get("state")!;
    const code = provider.issue(url, { sub: "db-error-state", email: "db-error-state@example.de", groups: ["haben-inhaber"] });
    await database`create function review_fail_session_state() returns trigger language plpgsql as $$ begin raise exception 'Testfehler'; end $$`;
    await database`create trigger review_fail_session_state before insert on session for each row execute function review_fail_session_state()`;
    try {
      const response = await request(`/callback/oidc?code=${code}&state=${state}`, cookieOf(started.headers));
      expect(response.headers.get("location")).toContain("sso=fehler");
    } finally {
      await database`drop trigger review_fail_session_state on session`;
      await database`drop function review_fail_session_state()`;
    }
    expect(await database`select id from verification where identifier=${`auth-state:${state}`}`).toHaveLength(0);
  });
});
