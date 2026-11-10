import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "./sso-test-provider.ts";

describe.skipIf(!testDatabaseUrl)("Gruppenherabstufung bei ungültigem Profil (Review)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  let client = 1;
  const request = (path: string, cookie = "", body?: unknown) =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: { origin: "http://localhost:3000", "x-forwarded-for": `127.5.0.${client++}`, cookie, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const login = async (identity: TestIdentity) => {
    const started = await request("/sign-in/social", "", { provider: "oidc" });
    expect(started.status).toBe(200);
    const url = new URL((await started.json()).url);
    const code = provider.issue(url, identity);
    return request(`/callback/oidc?code=${code}&state=${url.searchParams.get("state")}`, cookieOf(started.headers));
  };
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
  it("deaktiviert Tokens und alte Inhabersitzung auch bei profilbedingt abgewiesener geprüfter Herabstufung", async () => {
    const { createMcpToken, setMcpEnabled, authenticateMcp } = await import("./modules/mcp/index.ts");
    const { createCalendarToken, checkCalendarToken } = await import("./modules/finanzamt/index.ts");
    const { sessionUser } = await import("./rollen.ts");
    const owner = await login({ sub: "profile-owner", email: "owner@example.de", groups: ["haben-inhaber"] });
    const cookie = cookieOf(owner.headers);
    const user = (await sessionUser(new Headers({ cookie })))!;
    expect(user.role).toBe("inhaber");
    await setMcpEnabled(user.id, true);
    const token = await createMcpToken({ name: "Automation", days: 30 }, new Date(), user.id);
    const calendarToken = await createCalendarToken(user.id);
    const bearer = new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${token.token}` } });
    expect(await authenticateMcp(bearer)).not.toBeNull();
    expect(await checkCalendarToken(calendarToken)).toBe(true);

    // Ungeprüfte Protokollantwort und unveränderte Inhabergruppe dürfen nichts entziehen.
    await login({ sub: "profile-owner", email: "keine-email", groups: ["haben-steuerberatung"], wrongKey: true });
    const sameRole = await login({ sub: "profile-owner", email: "keine-email", groups: ["haben-inhaber"] });
    expect(sameRole.headers.get("location")).toContain("sso=profil");
    expect(await authenticateMcp(bearer)).not.toBeNull();
    expect(await checkCalendarToken(calendarToken)).toBe(true);
    expect(await sessionUser(new Headers({ cookie }))).toMatchObject({ role: "inhaber" });

    // Subject und Signatur bleiben gültig; UserInfo bestätigt die niedrigere Gruppe.
    const demoted = await login({ sub: "profile-owner", email: "keine-email", groups: ["haben-steuerberatung"] });
    expect(demoted.headers.get("location")).toContain("sso=profil");
    expect([await authenticateMcp(bearer), await checkCalendarToken(calendarToken), await sessionUser(new Headers({ cookie }))]).toEqual([null, false, null]);
  });
});
