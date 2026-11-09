import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "./sso-test-provider.ts";

/** SSO-Modus mit Authelia-Gruppen gegen einen kontrollierten Anbieter: echter Code-, JWKS- und UserInfo-Austausch */
describe.skipIf(!testDatabaseUrl)("SSO-Modus mit Gruppen (Postgres)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  let sessionUser: typeof import("./rollen.ts").sessionUser;
  let client = 1;

  const request = (path: string, body?: unknown, cookie = "", headers: Record<string, string> = {}) =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          // Eigene Adresse je Anfrage, damit das Rate-Limit von Better Auth die Tests nicht ausbremst
          "x-forwarded-for": `127.2.${Math.floor(client / 250)}.${client++ % 250}`,
          ...(body ? { "content-type": "application/json" } : {}),
          cookie,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

  async function begin(body: Record<string, unknown> = {}) {
    const response = await request("/sign-in/social", { provider: "oidc", callbackURL: "/", ...body });
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toContain("groups");
    return { url, cookie: cookieOf(response.headers) };
  }
  async function finish(flow: Awaited<ReturnType<typeof begin>>, identity: TestIdentity, cookie = flow.cookie) {
    const code = provider.issue(flow.url, identity);
    return request(`/callback/oidc?code=${code}&state=${flow.url.searchParams.get("state")}`, undefined, cookie);
  }
  const login = async (identity: TestIdentity) => finish(await begin(), identity);
  const location = (response: Response) => response.headers.get("location") ?? "";
  const succeeded = (response: Response) => response.status === 302 && !location(response).includes("sso=") && !location(response).includes("error");
  const reason = (response: Response) => new URL(location(response), "http://localhost").searchParams.get("sso");
  const userCount = async () => (await database`select count(*)::int as n from "user"`)[0]!.n as number;

  const inhaber = (sub: string): TestIdentity => ({ sub, email: `${sub}@example.de`, groups: ["haben-inhaber", "familie"] });
  const kanzlei = (sub: string): TestIdentity => ({ sub, email: `${sub}@example.de`, groups: ["haben-steuerberatung"] });
  const userOf = async (sub: string) => {
    const [row] = await database`select u.id, u.role from "user" u join account a on a.user_id = u.id
      where a.provider_id = 'oidc' and a.account_id = ${JSON.stringify([provider.issuer, sub])}`;
    return row as { id: string; role: string | null } | undefined;
  };
  const roleOf = async (userId: string) => {
    const rows = await database`select role from sso_roles where user_id = ${userId}`;
    return rows.length ? (rows[0]!.role as string | null) : "keine Zeile";
  };
  const sessionsOf = async (userId: string) => (await database`select count(*)::int as n from session where user_id = ${userId}`)[0]!.n as number;

  beforeAll(async () => {
    provider = await startTestProvider();
    Object.assign(process.env, ssoTestEnv(provider.issuer), { HABEN_SETUP_CODE: "test-setup-code" });
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
    ({ sessionUser } = await import("./rollen.ts"));
    // Zwei RSA-Schlüssel und eine Datenbank aus der Vorlage brauchen unter Volllast länger als die Vorgabe
  }, 60_000);
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    const { closeDatabase } = await import("./db/index.ts");
    await closeDatabase();
  });

  describe("Ersteinrichtung", () => {
    it("lässt die Steuerberatung die Instanz nicht erstmals einrichten", async () => {
      const response = await login(kanzlei("frueh-kanzlei"));
      expect(reason(response)).toBe("nicht-eingerichtet");
      expect(await userCount()).toBe(0);
      expect(await database`select * from sso_issuers`).toHaveLength(0);
    });

    it("verweigert ohne passende Gruppe auch auf der leeren Instanz", async () => {
      expect(reason(await login({ sub: "fremd", email: "fremd@example.de", groups: ["familie"] }))).toBe("gruppe");
      expect(await userCount()).toBe(0);
    });

    it("braucht keinen Einrichtungscode und lässt keinen lokalen Weg zu", async () => {
      const local = await request("/sign-up/email", { name: "Angriff", email: "lokal@example.de", password: "ein-langes-passwort" }, "", {
        "x-haben-setup-code": "test-setup-code",
      });
      expect([403, 404]).toContain(local.status);
      expect(await userCount()).toBe(0);
    });

    it("richtet mit mehreren gleichzeitigen Inhabern genau einmal ein, jede Identität genau einmal", async () => {
      const flows = await Promise.all([begin(), begin()]);
      const results = await Promise.all([finish(flows[0]!, inhaber("inhaberin-a")), finish(flows[1]!, inhaber("inhaber-b"))]);
      expect(results.every(succeeded)).toBe(true);
      const [issuers] = await database`select count(*)::int as n from sso_issuers where issuer = ${provider.issuer}`;
      expect(issuers!.n).toBe(1);
      for (const sub of ["inhaberin-a", "inhaber-b"]) {
        const user = await userOf(sub);
        expect(user).toMatchObject({ role: null });
        expect(await roleOf(user!.id)).toBe("inhaber");
      }
      // Keine lokalen Zugangsdaten, keine gespeicherten Provider-Tokens
      expect(await database`select id from account where provider_id <> 'oidc'`).toHaveLength(0);
      expect(await database`select id from account where access_token is not null or refresh_token is not null or id_token is not null`).toHaveLength(0);
      const [session] =
        await database`select oidc_issuer, sso_role, sso_checked_at, sso_expires_at from session where user_id = ${(await userOf("inhaberin-a"))!.id}`;
      expect(session).toMatchObject({ oidc_issuer: provider.issuer, sso_role: "inhaber" });
      const proof = new Date(session!.sso_expires_at).getTime() - new Date(session!.sso_checked_at).getTime();
      expect(proof).toBeLessThanOrEqual(15 * 60_000);
      expect(proof).toBeGreaterThan(14 * 60_000);
    });
  });

  describe("Automatische Anlage nach der Einrichtung", () => {
    it("legt die Steuerberatung ohne Einladung an, mit Rolle aus der Gruppe und ohne lokale Rolle", async () => {
      const response = await login(kanzlei("kanzlei-1"));
      expect(succeeded(response)).toBe(true);
      const user = await userOf("kanzlei-1");
      expect(user).toMatchObject({ role: null });
      expect(await roleOf(user!.id)).toBe("steuerberatung");
      const current = await sessionUser(new Headers({ cookie: cookieOf(response.headers) }));
      expect(current).toMatchObject({ id: user!.id, role: "steuerberatung" });
      const [logged] = await database`select role, method from user_logins where user_id = ${user!.id} order by id desc limit 1`;
      expect(logged).toMatchObject({ role: "steuerberatung", method: "sso" });
      expect(await database`select * from invitations`).toHaveLength(0);
    });

    it("legt dieselbe Identität bei parallelen Callbacks nur einmal an und hinterlässt keine Teilkonten", async () => {
      const flows = await Promise.all([begin(), begin()]);
      const identity = kanzlei("parallel");
      const results = await Promise.all(flows.map((flow) => finish(flow, identity)));
      expect(results.filter(succeeded).length).toBeGreaterThanOrEqual(1);
      expect(await database`select id from "user" where email = 'parallel@example.de'`).toHaveLength(1);
      expect(await database`select id from account where account_id = ${JSON.stringify([provider.issuer, "parallel"])}`).toHaveLength(1);
    });

    it("lehnt das Wiederholen eines Callbacks ab", async () => {
      const flow = await begin();
      const code = provider.issue(flow.url, kanzlei("replay"));
      const path = `/callback/oidc?code=${code}&state=${flow.url.searchParams.get("state")}`;
      expect(succeeded(await request(path, undefined, flow.cookie))).toBe(true);
      const before = await userCount();
      expect(succeeded(await request(path, undefined, flow.cookie))).toBe(false);
      expect(await userCount()).toBe(before);
    });

    it("lehnt einen Callback aus einem anderen Browser ab", async () => {
      const flow = await begin();
      expect(succeeded(await finish(flow, kanzlei("fremder-browser"), ""))).toBe(false);
      expect(await userOf("fremder-browser")).toBeUndefined();
    });

    it("rollt bei einem Datenbankfehler Konto, Zuordnung und Rolle gemeinsam zurück", async () => {
      // Kollision erst beim Einfügen der Sitzung: der Trigger wirft, alles davor muss verschwinden
      await database`create function test_fail_session() returns trigger language plpgsql as $$ begin raise exception 'Testfehler'; end $$`;
      await database`create trigger test_fail_session before insert on session for each row execute function test_fail_session()`;
      try {
        expect(reason(await login(kanzlei("db-fehler")))).toBe("fehler");
      } finally {
        await database`drop trigger test_fail_session on session`;
        await database`drop function test_fail_session()`;
      }
      expect(await database`select id from "user" where email = 'db-fehler@example.de'`).toHaveLength(0);
      expect(await database`select id from account where account_id = ${JSON.stringify([provider.issuer, "db-fehler"])}`).toHaveLength(0);
    });

    it("führt Konten mit gleicher E-Mail nicht zusammen und verweist auf die Übernahme", async () => {
      await database`insert into "user"(id, name, email, role) values ('lokal-alt', 'Alt', 'alt@example.de', 'steuerberatung')`;
      const response = await login({ sub: "neue-identitaet", email: "alt@example.de", groups: ["haben-steuerberatung"] });
      expect(reason(response)).toBe("konto-vorhanden");
      expect(await database`select id from account where user_id = 'lokal-alt'`).toHaveLength(0);
      expect(await database`select * from sso_roles where user_id = 'lokal-alt'`).toHaveLength(0);
    });

    it("nimmt eine Sitzung ohne SSO-Nachweis dieses Issuers nicht an und löscht sie an nativen Endpunkten", async () => {
      for (const issuer of [null, "https://anderer-anbieter.example"]) {
        const response = await login(kanzlei("kanzlei-1"));
        const cookie = cookieOf(response.headers);
        const token = decodeURIComponent(/session_token=([^;]+)/.exec(cookie)![1]!).split(".")[0]!;
        await database`update session set oidc_issuer = ${issuer} where token = ${token}`;
        expect((await request("/get-session", undefined, cookie)).status).toBe(401);
        expect(await database`select id from session where token = ${token}`).toHaveLength(0);
        expect(await sessionUser(new Headers({ cookie }))).toBeNull();
      }
    });
  });

  describe("Claims", () => {
    it.each([
      ["fehlender Claim", undefined],
      ["falscher Datentyp", "haben-inhaber"],
      ["Array mit Nicht-Zeichenkette", ["haben-inhaber", 7]],
      ["unbekannte Gruppe", ["Haben-Inhaber", "haben"]],
      ["doppelte Zuordnung", ["haben-inhaber", "haben-steuerberatung"]],
    ])("weist %s ab und legt nichts an", async (_name, groups) => {
      const sub = `claim-${String(_name).replace(/\W/g, "-")}`;
      expect(reason(await login({ sub, email: `${sub}@example.de`, groups }))).toBe(
        Array.isArray(groups) && groups.includes("haben-inhaber") && groups.includes("haben-steuerberatung") ? "gruppen-doppelt" : "gruppe",
      );
      expect(await userOf(sub)).toBeUndefined();
    });

    it("liest die Gruppen aus UserInfo und verlangt dort dasselbe Subject", async () => {
      const calls = provider.userInfoCalls();
      expect(reason(await login({ ...kanzlei("subject-a"), userInfo: { sub: "subject-b" } }))).toBe("fehler");
      expect(provider.userInfoCalls()).toBe(calls + 1);
      expect(await userOf("subject-a")).toBeUndefined();
    });

    it("lehnt ein falsch signiertes ID-Token ab, ohne UserInfo zu fragen oder ein bekanntes Konto anzufassen", async () => {
      const known = await userOf("kanzlei-1");
      const sessions = await sessionsOf(known!.id);
      const calls = provider.userInfoCalls();
      expect(succeeded(await login({ ...kanzlei("kanzlei-1"), groups: [], wrongKey: true }))).toBe(false);
      expect(provider.userInfoCalls()).toBe(calls);
      expect(await sessionsOf(known!.id)).toBe(sessions);
      expect(await roleOf(known!.id)).toBe("steuerberatung");
    });

    it("nimmt keine Rolle aus Browserangaben an", async () => {
      const flow = await begin({ additionalData: { role: "inhaber" }, requestSignUp: false, newUserCallbackURL: "https://boese.example" });
      expect(flow.url.origin).toBe(provider.issuer);
      const response = await finish(flow, kanzlei("browser-rolle"));
      expect(succeeded(response)).toBe(true);
      expect(location(response)).toBe("/");
      expect(await roleOf((await userOf("browser-rolle"))!.id)).toBe("steuerberatung");
      expect((await request("/sign-in/social", { provider: "oidc", scopes: ["admin"] })).status).toBe(403);
      expect((await request("/sign-in/social", { provider: "oidc", idToken: { token: "x" } })).status).toBe(403);
    });
  });

  describe("Rollen und Sitzungen", () => {
    it("befördert, widerruft dabei alle bisherigen Sitzungen und stellt die neue Sitzung mit der neuen Rolle aus", async () => {
      const first = await login(kanzlei("wechsel"));
      const second = await login(kanzlei("wechsel"));
      const user = (await userOf("wechsel"))!;
      expect(await sessionsOf(user.id)).toBe(2);
      const promoted = await login(inhaber("wechsel"));
      expect(succeeded(promoted)).toBe(true);
      expect(await sessionsOf(user.id)).toBe(1);
      for (const old of [first, second]) expect(await sessionUser(new Headers({ cookie: cookieOf(old.headers) }))).toBeNull();
      expect(await sessionUser(new Headers({ cookie: cookieOf(promoted.headers) }))).toMatchObject({ role: "inhaber" });
      expect(await roleOf(user.id)).toBe("inhaber");
      const changes =
        await database`select new_value ->> 'role' as role from audit_log where table_name = 'sso_roles' and new_value ->> 'user_id' = ${user.id} order by seq`;
      expect(changes.map((row) => row.role)).toEqual(["steuerberatung", "steuerberatung", "inhaber"]);
    });

    it("stuft herab und lässt die alte Inhaber-Sitzung nicht weiter schreiben", async () => {
      const owner = await login(inhaber("wechsel"));
      const demoted = await login(kanzlei("wechsel"));
      expect(await sessionUser(new Headers({ cookie: cookieOf(owner.headers) }))).toBeNull();
      expect(await sessionUser(new Headers({ cookie: cookieOf(demoted.headers) }))).toMatchObject({ role: "steuerberatung" });
    });

    it("widerruft bei Gruppenentzug alle SSO-Sitzungen, obwohl der Callback per Fehler-Redirect endet", async () => {
      const active = await login(kanzlei("entzug"));
      const user = (await userOf("entzug"))!;
      expect(await sessionUser(new Headers({ cookie: cookieOf(active.headers) }))).toBeTruthy();
      const rejected = await login({ ...kanzlei("entzug"), groups: ["familie"] });
      expect(reason(rejected)).toBe("gruppe");
      expect(await sessionsOf(user.id)).toBe(0);
      expect(await sessionUser(new Headers({ cookie: cookieOf(active.headers) }))).toBeNull();
      expect(await roleOf(user.id)).toBeNull();
      // Wieder in der Gruppe: wieder Zugang
      expect(succeeded(await login(kanzlei("entzug")))).toBe(true);
      expect(await roleOf(user.id)).toBe("steuerberatung");
    });

    it.each([
      ["doppelte Zuordnung", ["haben-inhaber", "haben-steuerberatung"]],
      ["ungültiger Claim", "haben-inhaber"],
      ["fehlender Claim", undefined],
    ])("widerruft auch bei %s", async (_name, groups) => {
      const active = await login(kanzlei("entzug-2"));
      const user = (await userOf("entzug-2"))!;
      expect(reason(await login({ ...kanzlei("entzug-2"), groups }))).toBe(
        Array.isArray(groups) && groups.includes("haben-inhaber") && groups.includes("haben-steuerberatung") ? "gruppen-doppelt" : "gruppe",
      );
      expect(await sessionsOf(user.id)).toBe(0);
      expect(await sessionUser(new Headers({ cookie: cookieOf(active.headers) }))).toBeNull();
    });

    it("verlängert die Frist weder durch Aktivität noch durch Sitzungsrefresh und verweigert danach", async () => {
      const response = await login(kanzlei("frist"));
      const cookie = cookieOf(response.headers);
      const user = (await userOf("frist"))!;
      const [before] = await database`select sso_expires_at from session where user_id = ${user.id}`;
      // Better Auth erneuert die Sitzung, wenn updatedAt älter als updateAge ist
      await database`update session set updated_at = now() - interval '2 days', expires_at = now() + interval '1 hour' where user_id = ${user.id}`;
      expect((await request("/get-session", undefined, cookie)).status).toBe(200);
      expect(await sessionUser(new Headers({ cookie }))).toBeTruthy();
      const [after] = await database`select sso_expires_at, expires_at from session where user_id = ${user.id}`;
      expect(new Date(after!.expires_at).getTime()).toBeGreaterThan(Date.now() + 2 * 3_600_000);
      expect(new Date(after!.sso_expires_at).getTime()).toBe(new Date(before!.sso_expires_at).getTime());
      await database`update session set sso_expires_at = now() - interval '1 second' where user_id = ${user.id}`;
      expect(await sessionUser(new Headers({ cookie }))).toBeNull();
      // Die abgelaufene Sitzung ist danach gelöscht; erneut hinein geht es nur über einen neuen SSO-Durchlauf
      expect(await sessionsOf(user.id)).toBe(0);
      expect(await (await request("/get-session", undefined, cookie)).json()).toBeNull();
    });

    it("kürzt die Frist auf einen früheren Tokenablauf", async () => {
      await login({ ...kanzlei("kurz"), accessTokenSeconds: 120 });
      const user = (await userOf("kurz"))!;
      const [session] = await database`select sso_checked_at, sso_expires_at from session where user_id = ${user.id}`;
      const proof = new Date(session!.sso_expires_at).getTime() - new Date(session!.sso_checked_at).getTime();
      expect(proof).toBeLessThanOrEqual(120_000);
    });

    it("entscheidet ohne lokale Sperre: Authelia bestimmt den Zugang", async () => {
      const user = (await userOf("kanzlei-1"))!;
      await database`update "user" set locked_at = now() where id = ${user.id}`;
      const response = await login(kanzlei("kanzlei-1"));
      expect(succeeded(response)).toBe(true);
      expect(await sessionUser(new Headers({ cookie: cookieOf(response.headers) }))).toMatchObject({ role: "steuerberatung" });
    });
  });

  describe("Gesperrte lokale Wege und Verwaltung", () => {
    it.each([
      "/sign-in/email",
      "/sign-up/email",
      "/change-password",
      "/set-password",
      "/request-password-reset",
      "/reset-password",
      "/link-social",
      "/unlink-account",
      "/passkey/generate-register-options",
      "/passkey/verify-authentication",
      "/get-access-token",
      "/refresh-token",
    ])("sperrt %s auch mit gültiger SSO-Sitzung", async (path) => {
      const cookie = cookieOf((await login(inhaber("inhaberin-a"))).headers);
      const response = await request(path, { email: "inhaberin-a@example.de", password: "ein-langes-passwort", provider: "oidc", providerId: "oidc" }, cookie);
      expect([403, 404, 405]).toContain(response.status);
      expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token=");
    });

    it("sperrt Einladen, Sperren, Freigeben und Entfernen serverseitig", async () => {
      const zugang = await import("./modules/zugang/index.ts");
      const owner = (await userOf("inhaberin-a"))!;
      const staff = (await userOf("kanzlei-1"))!;
      await expect(zugang.createInvitation(owner.id, { label: "Kanzlei" })).rejects.toThrow(/Authelia/);
      await expect(zugang.lockAccount(owner.id, staff.id)).rejects.toThrow(/Authelia/);
      await expect(zugang.unlockAccount(owner.id, staff.id)).rejects.toThrow(/Authelia/);
      await expect(zugang.removeAccount(owner.id, staff.id)).rejects.toThrow(/Authelia/);
      await expect(zugang.revokeInvitation(owner.id, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/Authelia/);
      expect(await userOf("kanzlei-1")).toBeTruthy();
    });

    it("zeigt in der Zugangsübersicht nur per SSO angemeldete Konten mit zuletzt bestätigter Rolle", async () => {
      const { listSsoAccounts } = await import("./modules/zugang/index.ts");
      const accounts = await listSsoAccounts(provider.issuer);
      const byEmail = Object.fromEntries(accounts.map((account) => [account.email, account.role]));
      expect(byEmail).toMatchObject({ "inhaberin-a@example.de": "inhaber", "kanzlei-1@example.de": "steuerberatung" });
      expect(byEmail).not.toHaveProperty("alt@example.de");
      expect(accounts[0]!.role).toBe("inhaber");
    });
  });
  it("deaktiviert Tokens erst nach geprüftem Gruppenentzug und erhält sie trotz Fehler-Redirect", async () => {
    const identity = inhaber("token-protokoll");
    expect(succeeded(await login(identity))).toBe(true);
    const user = (await userOf(identity.sub))!;
    const mcp = await import("./modules/mcp/index.ts");
    const calendar = await import("./modules/finanzamt/index.ts");
    await mcp.setMcpEnabled(user.id, true);
    const token = await mcp.createMcpToken({ name: "Protokolltest", days: 30 }, new Date(), user.id);
    const cal = await calendar.createCalendarToken(user.id);
    const authenticate = () => mcp.authenticateMcp(new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${token.token}` } }));
    expect(succeeded(await login({ ...identity, groups: [], wrongKey: true }))).toBe(false);
    expect(await authenticate()).not.toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(true);
    const response = await login({ ...identity, groups: [] });
    expect(reason(response)).toBe("gruppe");
    expect(await authenticate()).toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(false);
    expect((await database`select id,disabled_at from mcp_tokens where id=${token.id}`)[0]).toMatchObject({ id: token.id });
    expect((await database`select disabled_at from mcp_tokens where id=${token.id}`)[0]!.disabled_at).not.toBeNull();
  });
});
