import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "./sso-test-provider.ts";

/** Wechsel zwischen Standard- und SSO-Modus, ausdrückliche Übernahme bestehender Konten und Startprüfung (Postgres) */
describe.skipIf(!testDatabaseUrl)("Moduswechsel und SSO-Übernahme (Postgres)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let app: Awaited<ReturnType<typeof load>>;
  let client = 1;
  const password = "ein-sehr-langes-lokales-passwort";
  const owner: TestIdentity = { sub: "owner-sub", email: "owner@example.de", groups: ["haben-inhaber"] };
  let ownerId = "";
  let localCookie = "";
  let ssoCookie = "";
  let pendingSso: { url: URL; cookie: string } | undefined;

  /** Lädt die Anwendung mit frischer Konfiguration, wie ein Neustart mit geänderter OIDC_ONLY */
  async function load(sso: boolean) {
    vi.resetModules();
    process.env.OIDC_ONLY = sso ? "true" : "false";
    const [{ handleAuth, auth }, { sessionUser }, mode, takeover] = await Promise.all([
      import("./auth.ts"),
      import("./rollen.ts"),
      import("./sso-mode.ts"),
      import("./db/sso-uebernahme.ts"),
    ]);
    const problem = await mode.checkModeOnStartup();
    return { handleAuth, auth, sessionUser, mode, takeover, problem };
  }
  const request = (path: string, body?: unknown, cookie = "") =>
    app.handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-forwarded-for": `127.3.${Math.floor(client / 250)}.${client++ % 250}`,
          ...(body ? { "content-type": "application/json" } : {}),
          cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  async function begin() {
    const response = await request("/sign-in/social", { provider: "oidc" });
    expect(response.status).toBe(200);
    return { url: new URL((await response.json()).url), cookie: cookieOf(response.headers) };
  }
  const finish = (flow: { url: URL; cookie: string }, identity: TestIdentity) =>
    request(`/callback/oidc?code=${provider.issue(flow.url, identity)}&state=${flow.url.searchParams.get("state")}`, undefined, flow.cookie);
  const reason = (response: Response) => new URL(response.headers.get("location") ?? "/", "http://localhost").searchParams.get("sso");
  const takeOver = (apply: boolean, overrides: Partial<{ userId: string; issuer: string; subject: string }> = {}) =>
    app.takeover.ssoTakeover(database, { userId: ownerId, issuer: provider.issuer, subject: owner.sub, apply, ...overrides }, provider.issuer);

  beforeAll(async () => {
    provider = await startTestProvider();
    Object.assign(process.env, ssoTestEnv(provider.issuer), { HABEN_SETUP_CODE: "test-setup-code" });
    database = await setupTestDb();
    app = await load(false);
    const result = await app.auth().api.signUpEmail({
      body: { name: "Inhaberin", email: owner.email, password },
      headers: new Headers({ "x-haben-setup-code": "test-setup-code" }),
      returnHeaders: true,
    });
    localCookie = cookieOf(result.headers);
    ownerId = result.response.user.id;
    // Zwei RSA-Schlüssel und eine Datenbank aus der Vorlage brauchen unter Volllast länger als die Vorgabe
  }, 60_000);
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    const { closeDatabase } = await import("./db/index.ts");
    await closeDatabase();
  });

  it("deaktiviert im Standardmodus jeden OIDC-Weg", async () => {
    expect(app.problem).toBeNull();
    expect(await app.sessionUser(new Headers({ cookie: localCookie }))).toMatchObject({ id: ownerId, role: "inhaber" });
    expect((await request("/sign-in/social", { provider: "oidc" })).status).toBe(403);
    expect([403, 404]).toContain((await request("/callback/oidc?code=x&state=y")).status);
    expect([403, 404]).toContain((await request("/link-social", { provider: "oidc" }, localCookie)).status);
  });

  it("entwertet beim Wechsel in den SSO-Modus lokale Sitzungen und behält die Zugangsdaten", async () => {
    app = await load(true);
    expect(app.problem).toBeNull();
    expect(await database`select id from session where user_id = ${ownerId}`).toHaveLength(0);
    expect(await app.sessionUser(new Headers({ cookie: localCookie }))).toBeNull();
    expect(await database`select id from account where user_id = ${ownerId} and provider_id = 'credential'`).toHaveLength(1);
  });

  it("verweigert dem unverknüpften lokalen Inhaber den Zugang und verweist auf die Übernahme", async () => {
    expect(reason(await finish(await begin(), owner))).toBe("konto-vorhanden");
    expect(await database`select id from account where user_id = ${ownerId} and provider_id = 'oidc'`).toHaveLength(0);
  });

  it("lehnt die Übernahme ab, solange die Anwendung läuft", async () => {
    const release = await app.mode.holdAppRunningLock();
    try {
      expect(await takeOver(true)).toMatchObject({ ok: false, message: expect.stringMatching(/läuft noch/) });
    } finally {
      await release();
    }
  });

  it.each([
    ["fremder Issuer", { issuer: "https://anderer-anbieter.example" }, /nicht der konfigurierte/],
    ["unbekanntes Konto", { userId: "gibt-es-nicht" }, /gibt es nicht/],
    ["leeres Subject", { subject: "" }, /Subject/],
  ])("lehnt die Übernahme ab: %s", async (_name, overrides, message) => {
    expect(await takeOver(true, overrides)).toMatchObject({ ok: false, message: expect.stringMatching(message) });
    expect(await database`select id from sso_takeovers`).toHaveLength(0);
  });

  it("prüft ohne Änderung und übernimmt dann ausdrücklich, ohne Rolle zu vergeben", async () => {
    expect(await takeOver(false)).toMatchObject({ ok: true, applied: false });
    expect(await database`select id from account where provider_id = 'oidc'`).toHaveLength(0);
    expect(await takeOver(true)).toMatchObject({ ok: true, applied: true });
    expect(await database`select user_id from account where provider_id = 'oidc'`).toEqual([{ user_id: ownerId }]);
    expect(await database`select * from sso_roles`).toHaveLength(0);
    const [audit] = await database`select actor, new_value from audit_log where table_name = 'sso_takeovers'`;
    expect(audit).toMatchObject({ actor: "system:sso-uebernahme", new_value: { user_id: ownerId, subject: owner.sub } });
    expect(await takeOver(true)).toMatchObject({ ok: false, message: expect.stringMatching(/bereits zugeordnet/) });
  });

  it("lehnt ein fremd belegtes Subject ab", async () => {
    await database`insert into "user"(id, name, email, role) values ('kanzlei-lokal', 'Kanzlei', 'kanzlei@example.de', 'steuerberatung')`;
    expect(await takeOver(true, { userId: "kanzlei-lokal" })).toMatchObject({ ok: false, message: expect.stringMatching(/anderen Konto/) });
  });

  it("meldet den übernommenen Inhaber mit der Gruppe an; die lokale Rolle bleibt, die Rolle kommt aus der Gruppe", async () => {
    // Die Übernahme vergibt keine Rolle: mit der Steuerberatungs-Gruppe richtet niemand die Instanz ein
    expect(reason(await finish(await begin(), { ...owner, groups: ["haben-steuerberatung"] }))).toBe("nicht-eingerichtet");
    const first = await finish(await begin(), owner);
    expect(await app.sessionUser(new Headers({ cookie: cookieOf(first.headers) }))).toMatchObject({ id: ownerId, role: "inhaber" });
    const demoted = await finish(await begin(), { ...owner, groups: ["haben-steuerberatung"] });
    expect(await app.sessionUser(new Headers({ cookie: cookieOf(demoted.headers) }))).toMatchObject({ id: ownerId, role: "steuerberatung" });
    const promoted = await finish(await begin(), owner);
    ssoCookie = cookieOf(promoted.headers);
    expect(await app.sessionUser(new Headers({ cookie: ssoCookie }))).toMatchObject({ id: ownerId, role: "inhaber" });
    expect(await database`select role from "user" where id = ${ownerId}`).toEqual([{ role: "inhaber" }]);
    // Frühere Audit-Einträge des Kontos bleiben ihm zugeordnet: dieselbe Konto-ID
    const [logins] = await database`select count(*)::int as n from user_logins where user_id = ${ownerId}`;
    expect(logins!.n).toBeGreaterThanOrEqual(3);
    pendingSso = await begin();
  });

  it("lässt beim Zurückschalten weder SSO-Sitzungen noch laufende Callbacks gelten", async () => {
    app = await load(false);
    expect(app.problem).toBeNull();
    expect(await app.sessionUser(new Headers({ cookie: ssoCookie }))).toBeNull();
    const callback = await finish(pendingSso!, owner);
    expect(callback.headers.get("set-cookie") ?? "").not.toContain("session_token=");
    expect(await database`select id from session where user_id = ${ownerId}`).toHaveLength(0);
    const local = await app.auth().api.signInEmail({ body: { email: owner.email, password }, returnHeaders: true });
    expect(await app.sessionUser(new Headers({ cookie: cookieOf(local.headers) }))).toMatchObject({ role: "inhaber" });
  });

  it("bricht den Standardmodus ohne verwendbaren lokalen Inhaber verständlich ab", async () => {
    await database`delete from account where user_id = ${ownerId} and provider_id = 'credential'`;
    app = await load(false);
    expect(app.problem).toMatch(/ohne verwendbaren lokalen Inhaber/);
    expect((await request("/sign-in/email", { email: owner.email, password })).status).toBe(503);
    // Keine automatische Erzeugung lokaler Zugangsdaten
    expect(await database`select id from account where provider_id = 'credential'`).toHaveLength(0);
    app = await load(true);
    expect(app.problem).toBeNull();
  });
});
