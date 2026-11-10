import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "./sso-test-provider.ts";

/** Review: State und Nonce eines SSO-Vorgangs gelten genau einmal, auch wenn der erste Callback abgewiesen wurde */
describe.skipIf(!testDatabaseUrl)("SSO-State nach abgewiesenem Callback (Review)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
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
  const finish = (flow: { url: URL; cookie: string }, identity: TestIdentity) =>
    request(`/callback/oidc?code=${provider.issue(flow.url, identity)}&state=${flow.url.searchParams.get("state")}`, undefined, flow.cookie);
  const location = (response: Response) => response.headers.get("location") ?? "";
  const succeeded = (response: Response) => response.status === 302 && !location(response).includes("sso=") && !location(response).includes("error");
  const reason = (response: Response) => new URL(location(response), "http://localhost").searchParams.get("sso");

  beforeAll(async () => {
    provider = await startTestProvider();
    Object.assign(process.env, ssoTestEnv(provider.issuer), { HABEN_SETUP_CODE: "test-setup-code" });
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
    // Zwei RSA-Schlüssel und eine Datenbank aus der Vorlage brauchen unter Volllast länger als die Vorgabe
  }, 60_000);
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    const { closeDatabase } = await import("./db/index.ts");
    await closeDatabase();
  });

  it("nimmt denselben State nach einer Gruppen-Abweisung kein zweites Mal an", async () => {
    expect(succeeded(await finish(await begin(), { sub: "owner", email: "owner@example.de", groups: ["haben-inhaber"] }))).toBe(true);

    const flow = await begin();
    const rejected = await finish(flow, { sub: "wieder", email: "wieder@example.de", groups: ["familie"] });
    expect(reason(rejected)).toBe("gruppe");

    // Derselbe State (und damit dieselbe Nonce und derselbe PKCE-Verifier) ein zweites Mal
    const replay = await finish(flow, { sub: "wieder", email: "wieder@example.de", groups: ["haben-inhaber"] });
    expect(succeeded(replay)).toBe(false);
    expect(await database`select id from "user" where email = 'wieder@example.de'`).toHaveLength(0);
  });

  it("nimmt denselben State nach Abweisung wegen doppelter Gruppen kein zweites Mal an", async () => {
    const flow = await begin();
    expect(reason(await finish(flow, { sub: "doppelt", email: "doppelt@example.de", groups: ["haben-inhaber", "haben-steuerberatung"] }))).toBe(
      "gruppen-doppelt",
    );
    const replay = await finish(flow, { sub: "doppelt", email: "doppelt@example.de", groups: ["haben-steuerberatung"] });
    expect(succeeded(replay)).toBe(false);
    expect(await database`select id from "user" where email = 'doppelt@example.de'`).toHaveLength(0);
  });
});
