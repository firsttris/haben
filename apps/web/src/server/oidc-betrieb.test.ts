import { format } from "node:util";
import type postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "./sso-test-provider.ts";
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
    const [{ handleAuth, auth }, { sessionUser }] = await Promise.all([import("./auth.ts"), import("./rollen.ts")]);
    return { handleAuth, auth, sessionUser };
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

  it("nennt einen Fehlercode des Anbieters im Log, aber nur unbedenkliche Zeichen", async () => {
    const app = await load();
    const started = await begin(app);
    const url = new URL((await started.json()).url);
    const messages: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      messages.push(format(...args));
    });
    const error = encodeURIComponent("invalid_scope\nSSO: gefaelscht");
    await request(app, `/callback/oidc?error=${error}&state=${url.searchParams.get("state")}`, undefined, cookieOf(started.headers));
    const line = messages.find((message) => message.includes("abgewiesen"))!;
    expect(line).toContain("invalid_scope");
    expect(line.split("\n")).toHaveLength(1);
  }, 60_000);

  const openTransactions = async () =>
    (await database`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`)[0]!.n as number;

  async function callback(app: App, identity: TestIdentity) {
    const started = await begin(app);
    const url = new URL((await started.json()).url);
    return request(app, `/callback/oidc?code=${provider.issue(url, identity)}&state=${url.searchParams.get("state")}`, undefined, cookieOf(started.headers));
  }
  const owner = (sub: string): TestIdentity => ({ sub, email: `${sub}@example.de`, groups: ["haben-inhaber"] });
  const failed = (response: Response) => response.headers.get("location")?.includes("sso=") ?? true;

  it("hält während der Anbieteraufrufe keine Datenbanktransaktion offen", async () => {
    const app = await load();
    const during: number[] = [];
    provider.setUserInfoHook(async () => {
      during.push(await openTransactions());
    });
    expect(failed(await callback(app, owner("netz")))).toBe(false);
    expect(during).toEqual([0]);
    expect(await openTransactions()).toBe(0);
  }, 60_000);

  it("lässt viele gleichzeitige Callbacks durch, auch wenn der Anbieter langsam antwortet", async () => {
    const app = await load();
    expect(failed(await callback(app, owner("erste")))).toBe(false);
    provider.setUserInfoHook(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const flows = await Promise.all(Array.from({ length: 12 }, (_, i) => callback(app, owner(`parallel-${i}`))));
    expect(flows.filter(failed)).toHaveLength(0);
    expect((await database`select count(*)::int as n from session`)[0]!.n).toBe(13);
  }, 60_000);

  it("rollt bei einem Fehler erst beim Commit alles zurück und gibt die Verbindung frei", async () => {
    const app = await load();
    expect(failed(await callback(app, owner("vorher")))).toBe(false);
    const before = (await database`select count(*)::int as n from "user"`)[0]!.n;
    await database`create function test_commit_fail() returns trigger language plpgsql as $$ begin raise exception 'beim Commit'; end $$`;
    await database`create constraint trigger test_commit_fail after insert on session deferrable initially deferred for each row execute function test_commit_fail()`;
    const response = await callback(app, owner("commit"));
    await database`drop trigger test_commit_fail on session`;
    await database`drop function test_commit_fail()`;
    expect(response.headers.get("location")).toContain("sso=fehler");
    expect(response.headers.getSetCookie().join()).not.toContain("session_token");
    expect((await database`select count(*)::int as n from "user"`)[0]!.n).toBe(before);
    expect(await openTransactions()).toBe(0);
  }, 60_000);

  it("gibt die Verbindung auch nach einem Fehler im Schreibteil frei und lässt danach wieder anmelden", async () => {
    const app = await load();
    expect(failed(await callback(app, owner("davor")))).toBe(false);
    await database`create function test_session_fail() returns trigger language plpgsql as $$ begin raise exception 'Schreibfehler'; end $$`;
    await database`create trigger test_session_fail before insert on session for each row execute function test_session_fail()`;
    for (let i = 0; i < 12; i++) expect((await callback(app, owner(`fehler-${i}`))).headers.get("location")).toContain("sso=fehler");
    await database`drop trigger test_session_fail on session`;
    await database`drop function test_session_fail()`;
    expect(await openTransactions()).toBe(0);
    expect(failed(await callback(app, owner("danach")))).toBe(false);
  }, 60_000);

  it("nimmt keine eigenen Zusatzdaten für den OAuth-State an", async () => {
    const app = await load();
    expect((await request(app, "/sign-in/social", { provider: "oidc", additionalData: { beliebig: "x".repeat(1000) } })).status).toBe(403);
  }, 60_000);
});
