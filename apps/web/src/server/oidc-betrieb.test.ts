import { format } from "node:util";
import type postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieOf, ssoTestEnv, startTestProvider, type TestProvider } from "./sso-test-provider.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/** Betrieb mit einem OIDC-Anbieter: Ausfall beim Start, angefragte Scopes, Diagnose im Log, Auslastung des Callbacks */
describe.skipIf(!testDatabaseUrl)("OIDC im Betrieb (Postgres)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let client = 1;

  async function load(extra: Record<string, string> = {}) {
    vi.resetModules();
    delete process.env.OIDC_SCOPES;
    Object.assign(process.env, ssoTestEnv(provider.issuer), extra);
    database = await setupTestDb();
    const [{ handleAuth, auth }, { sessionUser }, { atomicAuthCallback }] = await Promise.all([
      import("./auth.ts"),
      import("./rollen.ts"),
      import("./auth-transaction.ts"),
    ]);
    return { handleAuth, auth, sessionUser, atomicAuthCallback };
  }
  type App = Awaited<ReturnType<typeof load>>;
  const request = (app: App, path: string, body?: unknown, cookie = "") =>
    app.handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-forwarded-for": `127.4.${Math.floor(client / 250)}.${client++ % 250}`,
          ...(body ? { "content-type": "application/json" } : {}),
          cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const begin = (app: App) => request(app, "/sign-in/social", { provider: "oidc" });

  beforeEach(async () => {
    provider = await startTestProvider();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await provider?.close();
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
  });
  afterAll(() => {
    delete process.env.OIDC_SCOPES;
  });

  it("holt eine beim Start gescheiterte Discovery nach, sobald der Anbieter wieder antwortet", async () => {
    provider.setDiscovery("fehler");
    const app = await load();
    await app.auth().$context;
    expect((await begin(app)).status).not.toBe(200);
    provider.setDiscovery("ok");
    const response = await begin(app);
    expect(response.status).toBe(200);
    expect(new URL((await response.json()).url).origin).toBe(provider.issuer);
  }, 60_000);

  it("hält Seitenaufrufe nicht an einem Anbieter fest, der beim Start nicht antwortet", async () => {
    provider.setDiscovery("haengt");
    const app = await load();
    const started = Date.now();
    await expect(app.sessionUser(new Headers())).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("fragt mit OIDC_SCOPES genau diese Scopes an, auch wenn profile fehlt", async () => {
    const app = await load({ OIDC_SCOPES: "openid email groups" });
    const response = await begin(app);
    expect(new URL((await response.json()).url).searchParams.get("scope")).toBe("openid email groups");
  }, 60_000);

  it("nennt die Ursache einer gescheiterten Anmeldung im Log, ohne Code oder Geheimnis", async () => {
    const app = await load();
    const started = await begin(app);
    const url = new URL((await started.json()).url);
    const messages: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      messages.push(format(...args));
    });
    const code = "unbekannter-code-der-nicht-ins-log-gehoert";
    await request(app, `/callback/oidc?code=${code}&state=${url.searchParams.get("state")}`, undefined, cookieOf(started.headers));
    expect(messages.join("\n")).toMatch(/Token-Endpunkt.*400.*invalid_grant/);
    expect(messages.join("\n")).not.toContain(code);
    expect(messages.join("\n")).not.toContain("secret");
  }, 60_000);

  it("nennt den Grund einer Abweisung wegen der Gruppen im Log", async () => {
    const app = await load();
    const started = await begin(app);
    const url = new URL((await started.json()).url);
    const messages: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      messages.push(format(...args));
    });
    const code = provider.issue(url, { sub: "ohne-gruppen", email: "ohne@example.de" });
    await request(app, `/callback/oidc?code=${code}&state=${url.searchParams.get("state")}`, undefined, cookieOf(started.headers));
    expect(messages.join("\n")).toMatch(/abgewiesen.*gruppe.*fehlt/);
    expect(messages.join("\n")).not.toContain("ohne@example.de");
  }, 60_000);

  it("leitet einen Callback bei Auslastung zur Anmeldeseite statt auf eine Textseite", async () => {
    const app = await load();
    let release = () => {};
    const blocked = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 302, headers: { location: "/" } }));
    });
    const options = { errorUrl: (reason: string) => `http://localhost:3000/login?sso=${reason}` };
    const running = Array.from({ length: 4 }, () => app.atomicAuthCallback(() => blocked, options));
    const refused = await app.atomicAuthCallback(() => Promise.resolve(new Response()), options);
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toContain("sso=ausgelastet");
    release();
    await Promise.all(running);
  }, 60_000);
});
