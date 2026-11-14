import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf } from "./sso-test-provider.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Passwortwechsel (Postgres)", () => {
  let database: postgres.Sql;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  const email = "inhaber@example.de";
  const currentPassword = "ein-langes-altes-testpasswort";
  const newPassword = "ein-langes-neues-testpasswort";
  let client = 1;

  const request = (path: string, body?: unknown, headers?: Record<string, string>) =>
    handleAuth(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: "http://localhost:3000",
          "x-forwarded-for": `127.0.0.${client++}`,
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

  beforeAll(async () => {
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
  }, 60_000);

  afterAll(async () => {
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
  });

  it("widerruft Sitzungen und protokolliert nur einen erfolgreichen Passwortwechsel", async () => {
    const { setupCode } = await import("./setup-code.ts");
    const signedUp = await request("/sign-up/email", { name: "Inhaber", email, password: currentPassword }, { "x-haben-setup-code": setupCode() });
    expect(signedUp.ok).toBe(true);
    const { user } = await signedUp.json();
    const cookie = cookieOf(signedUp.headers);
    const signedIn = await request("/sign-in/email", { email, password: currentPassword });
    expect(signedIn.ok).toBe(true);
    const otherCookie = cookieOf(signedIn.headers);
    const audit = () => database`select actor, row_id, old_value, new_value from audit_log where new_value ->> 'ereignis' = 'passwort_geaendert'`;
    const change = (body: Partial<{ currentPassword: string; newPassword: string; revokeOtherSessions: boolean }> = {}) =>
      request("/change-password", { currentPassword, newPassword, revokeOtherSessions: true, ...body }, { cookie });

    expect((await change({ currentPassword: "ein-falsches-passwort" })).status).toBe(400);
    expect((await change({ newPassword: "zu-kurz" })).status).toBe(400);
    expect((await change({ newPassword: currentPassword })).status).toBe(400);
    expect((await change({ newPassword: currentPassword.replace("e", "ｅ") })).status).toBe(400);
    expect((await change({ revokeOtherSessions: false })).status).toBe(403);
    expect(await audit()).toEqual([]);
    expect(await database`select id from session where user_id = ${user.id}`).toHaveLength(2);

    await database`create function test_fail_password_audit() returns trigger language plpgsql as $$
      begin
        if new.new_value ->> 'ereignis' = 'passwort_geaendert' then raise exception 'Testfehler'; end if;
        return new;
      end $$`;
    await database`create trigger test_fail_password_audit before insert on audit_log for each row execute function test_fail_password_audit()`;
    try {
      expect((await change()).status).toBe(503);
      expect(await database`select id from session where user_id = ${user.id}`).toHaveLength(2);
    } finally {
      await database`drop trigger test_fail_password_audit on audit_log`;
    }

    const changed = await change();
    expect(changed.ok).toBe(true);
    expect(await (await request("/get-session", undefined, { cookie: otherCookie })).json()).toBeNull();
    expect(await (await request("/get-session", undefined, { cookie: cookieOf(changed.headers) })).json()).toMatchObject({ user: { id: user.id } });
    expect((await request("/sign-in/email", { email, password: currentPassword })).ok).toBe(false);
    expect((await request("/sign-in/email", { email, password: newPassword })).ok).toBe(true);
    expect(await audit()).toEqual([{ actor: user.id, row_id: user.id, old_value: null, new_value: { ereignis: "passwort_geaendert" } }]);
  });
});
