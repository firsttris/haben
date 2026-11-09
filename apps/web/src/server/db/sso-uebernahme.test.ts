import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cookieOf, ssoTestEnv, startTestProvider, type TestIdentity, type TestProvider } from "../sso-test-provider.ts";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

/** Ausdrückliches Ersetzen einer Identität, wenn der Anbieter dasselbe Konto mit neuem Subject führt (Postgres) */
describe.skipIf(!testDatabaseUrl)("Identität einer SSO-Übernahme ersetzen (Postgres)", () => {
  let database: postgres.Sql;
  let provider: TestProvider;
  let handleAuth: typeof import("../auth.ts").handleAuth;
  let takeover: typeof import("./sso-uebernahme.ts").ssoTakeover;
  let client = 1;
  let run = 0;
  let oldSub = "";
  let newSub = "";
  let email = "";
  let userId = "";

  const request = (path: string, body?: unknown, cookie = "") =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-forwarded-for": `127.5.${Math.floor(client / 250)}.${client++ % 250}`,
          ...(body ? { "content-type": "application/json" } : {}),
          cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  async function login(identity: TestIdentity) {
    const started = await request("/sign-in/social", { provider: "oidc" });
    const url = new URL((await started.json()).url);
    const response = await request(
      `/callback/oidc?code=${provider.issue(url, identity)}&state=${url.searchParams.get("state")}`,
      undefined,
      cookieOf(started.headers),
    );
    return new URL(response.headers.get("location") ?? "/", "http://localhost").searchParams.get("sso");
  }
  const person = (sub: string): TestIdentity => ({ sub, email, groups: ["haben-inhaber"] });
  const replace = (apply: boolean, overrides: Partial<{ userId: string; subject: string; replace: boolean }> = {}) =>
    takeover(database, { userId, issuer: provider.issuer, subject: newSub, apply, replace: true, ...overrides }, provider.issuer);
  const identities = async () =>
    (await database`select account_id from account where provider_id = 'oidc' and user_id = ${userId}`).map((row) => row.account_id);
  const key = (subject: string) => JSON.stringify([provider.issuer, subject]);

  beforeAll(async () => {
    provider = await startTestProvider();
    Object.assign(process.env, ssoTestEnv(provider.issuer));
    database = await setupTestDb();
    ({ handleAuth } = await import("../auth.ts"));
    ({ ssoTakeover: takeover } = await import("./sso-uebernahme.ts"));
  }, 60_000);
  beforeEach(async () => {
    run++;
    oldSub = `alt-${run}`;
    newSub = `neu-${run}`;
    email = `konto-${run}@example.de`;
    expect(await login(person(oldSub))).toBeNull();
    userId = (await database`select user_id from account where account_id = ${key(oldSub)}`)[0]!.user_id;
  });
  afterAll(async () => {
    await provider?.close();
    await database?.end();
    await (await import("./index.ts")).closeDatabase();
  });

  it("weist ein neues Subject beim Anmelden ab und ersetzt ohne --ersetzen nichts", async () => {
    expect(await login(person(newSub))).toBe("konto-vorhanden");
    expect(await replace(true, { replace: false })).toMatchObject({ ok: false, message: expect.stringMatching(/--ersetzen/) });
    expect(await identities()).toEqual([key(oldSub)]);
  });

  it("ändert im Trockenlauf nichts und nennt das bisherige Subject", async () => {
    expect(await replace(false)).toMatchObject({ ok: true, applied: false, message: expect.stringContaining(oldSub) });
    expect(await identities()).toEqual([key(oldSub)]);
    expect(await database`select id from sso_takeovers where user_id = ${userId}`).toHaveLength(0);
  });

  it("verlangt eine vorhandene Identität und ein freies Subject", async () => {
    await database`insert into "user"(id, name, email, role) values (${`ohne-${run}`}, 'Ohne', ${`ohne-${run}@example.de`}, null)`;
    expect(await replace(true, { userId: `ohne-${run}` })).toMatchObject({ ok: false, message: expect.stringMatching(/keine Identität/) });
    await database`insert into "user"(id, name, email, role) values (${`belegt-${run}`}, 'Belegt', ${`belegt-${run}@example.de`}, null)`;
    await database`insert into account(id, account_id, provider_id, user_id) values (${`belegt-${run}`}, ${key(newSub)}, 'oidc', ${`belegt-${run}`})`;
    expect(await replace(true)).toMatchObject({ ok: false, message: expect.stringMatching(/anderen Konto/) });
    expect(await identities()).toEqual([key(oldSub)]);
  });

  it("ersetzt die Identität, beendet Sitzungen, verlangt neue Bestätigung und protokolliert das alte Subject", async () => {
    expect((await database`select id from session where user_id = ${userId}`).length).toBeGreaterThan(0);
    expect(await replace(true)).toMatchObject({ ok: true, applied: true });
    expect(await identities()).toEqual([key(newSub)]);
    expect(await database`select id from session where user_id = ${userId}`).toHaveLength(0);
    expect(await database`select role from sso_roles where user_id = ${userId}`).toHaveLength(0);
    const [audit] = await database`select actor, new_value from audit_log where table_name = 'sso_takeovers' and new_value ->> 'user_id' = ${userId}`;
    expect(audit).toMatchObject({ actor: "system:sso-uebernahme", new_value: { subject: newSub, replaced_subject: oldSub } });

    // Dasselbe Konto mit dem neuen Subject, das alte kommt nicht mehr hinein
    expect(await login(person(newSub))).toBeNull();
    expect((await database`select user_id from account where account_id = ${key(newSub)}`)[0]!.user_id).toBe(userId);
    expect(await database`select role from sso_roles where user_id = ${userId}`).toEqual([{ role: "inhaber" }]);
    expect(await login(person(oldSub))).toBe("konto-vorhanden");
    expect(await identities()).toEqual([key(newSub)]);
  });

  it("lässt die Identität eines anderen Issuers unberührt", async () => {
    const foreign = JSON.stringify(["https://anderer-anbieter.example", "x"]);
    await database`insert into account(id, account_id, provider_id, user_id) values (${`fremd-${run}`}, ${foreign}, 'oidc', ${userId})`;
    expect(await replace(true)).toMatchObject({ ok: true, applied: true });
    expect((await identities()).sort()).toEqual([foreign, key(newSub)].sort());
  });
});
