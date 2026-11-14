import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { APP_RUNNING_LOCK } from "./app-lock.ts";
import { prepareLocalOwner, resetLocalOwnerPassword } from "./local-owner.ts";

describe.skipIf(!testDatabaseUrl)("Offline-Rückweg aus SSO (Postgres)", () => {
  let database: postgres.Sql;
  const password = "ein-neues-lokales-passwort";
  beforeAll(async () => {
    vi.stubEnv("OIDC_ONLY", "false");
    database = await setupTestDb();
  }, 60_000);
  beforeEach(async () => {
    await leeren(database)`truncate "user" cascade`;
    await database`insert into "user"(id,name,email,role) values('sso','SSO','sso@example.de',null),('other','Andere','other@example.de',null)`;
    await database`insert into account(id,account_id,provider_id,user_id) values('identity','["https://offline.invalid","subject"]','oidc','sso')`;
  });
  afterAll(async () => {
    await database?.end();
    await (await import("./index.ts")).closeDatabase();
    vi.unstubAllEnvs();
  });
  it("prüft ohne Änderungen und ohne erreichbaren IdP", async () => {
    expect(await prepareLocalOwner(database, { userId: "sso", apply: false })).toEqual({ applied: false, passwordRequired: true });
    expect((await database`select role from "user" where id='sso'`)[0]!.role).toBeNull();
    expect(await database`select id from account where provider_id='credential'`).toHaveLength(0);
  });
  it("erhält Identität und Konto, setzt einen Hash und ermöglicht echte lokale Anmeldung", async () => {
    await prepareLocalOwner(database, { userId: "sso", apply: true, password });
    const { auth } = await import("../auth.ts");
    const result = await auth().api.signInEmail({ body: { email: "sso@example.de", password }, headers: new Headers({ origin: "http://localhost:3000" }) });
    expect(result.user.id).toBe("sso");
    expect(await database`select id from account where provider_id='oidc'`).toHaveLength(1);
    const [credential] = await database`select password from account where provider_id='credential'`;
    expect(credential!.password).not.toBe(password);
    expect(await database`select user_id from local_owner_recoveries where user_id='sso'`).not.toHaveLength(0);
    expect(JSON.stringify(await database`select new_value from audit_log where table_name='local_owner_recoveries'`)).not.toContain(password);
  });
  it("verweigert Arbeit bei laufender Anwendung", async () => {
    const lockClient = postgres(testDatabaseUrl!, { max: 1 });
    const connection = await lockClient.reserve();
    try {
      await connection`select pg_advisory_lock_shared(${APP_RUNNING_LOCK})`;
      await expect(prepareLocalOwner(database, { userId: "sso", apply: true, password })).rejects.toThrow(/stoppen/);
    } finally {
      await connection`select pg_advisory_unlock_shared(${APP_RUNNING_LOCK})`;
      connection.release();
      await lockClient.end();
    }
  });
  it("ersetzt keinen anderen lokalen Inhaber", async () => {
    await database`insert into "user"(id,name,email,role) values('local','Lokal','local@example.de','inhaber')`;
    await expect(prepareLocalOwner(database, { userId: "sso", apply: true, password })).rejects.toThrow(/anderen lokalen Inhaber/);
  });
  it("verlangt Passwort für reine SSO-Konten und lässt gewöhnliche Rollenänderungen gesperrt", async () => {
    await expect(prepareLocalOwner(database, { userId: "sso", apply: true })).rejects.toThrow(/Passwort/);
    await expect(database`update "user" set role='inhaber' where id='sso'`).rejects.toThrow(/Rolle/);
    await expect(prepareLocalOwner(database, { userId: "sso", apply: true, password: "kurz" })).rejects.toThrow(/12 Zeichen/);
  });
  it("macht aus einem Steuerberatungskonto keinen Inhaber, weder per Skript noch am Trigger vorbei", async () => {
    await database`insert into "user"(id,name,email,role) values('kanzlei','Kanzlei','kanzlei@example.de','steuerberatung')`;
    await expect(prepareLocalOwner(database, { userId: "kanzlei", apply: true, password })).rejects.toThrow(/Steuerberatung/);
    await expect(
      database.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'system:local-owner-recovery', true)`;
        await tx`select haben_prepare_local_owner('kanzlei')`;
      }),
    ).rejects.toThrow(/Rolle/);
    expect((await database`select role from "user" where id='kanzlei'`)[0]!.role).toBe("steuerberatung");
  });
  it("setzt ein übergebenes Passwort auch bei vorhandenem Zugang neu", async () => {
    await prepareLocalOwner(database, { userId: "sso", apply: true, password: "das-alte-vergessene-passwort" });
    await database`update "user" set locked_at=null where id='sso'`;
    await prepareLocalOwner(database, { userId: "sso", apply: true, password });
    expect(await database`select id from account where provider_id='credential'`).toHaveLength(1);
    const { auth } = await import("../auth.ts");
    const result = await auth().api.signInEmail({ body: { email: "sso@example.de", password }, headers: new Headers({ origin: "http://localhost:3000" }) });
    expect(result.user.id).toBe("sso");
  });
  it("setzt das vergessene Inhaberpasswort ohne Passkey zurück und beendet nur dessen Sitzungen", async () => {
    const oldPassword = "das-alte-vergessene-passwort";
    await prepareLocalOwner(database, { userId: "sso", apply: true, password: oldPassword });
    const { auth } = await import("../auth.ts");
    const signIn = (password: string) =>
      auth().api.signInEmail({ body: { email: "sso@example.de", password }, headers: new Headers({ origin: "http://localhost:3000" }) });
    expect((await signIn(oldPassword)).user.id).toBe("sso");
    await database`insert into session(id,token,expires_at,user_id) values('other-session','other-token',now() + interval '1 hour','other')`;
    const readAudit = () =>
      database`select actor, row_id, old_value, new_value from audit_log where new_value->>'ereignis'='passwort_zurueckgesetzt' and row_id='sso'`;
    const previousAudit = await readAudit();

    await resetLocalOwnerPassword(database, password, false);

    expect(await database`select user_id from session order by user_id`).toEqual([{ user_id: "other" }]);
    await expect(signIn(oldPassword)).rejects.toThrow();
    expect((await signIn(password)).user.id).toBe("sso");
    expect(await database`select role from "user" where id='sso'`).toEqual([{ role: "inhaber" }]);
    expect(await readAudit()).toEqual([
      ...previousAudit,
      { actor: "system:local-owner-recovery", row_id: "sso", old_value: null, new_value: { ereignis: "passwort_zurueckgesetzt" } },
    ]);
  });
  it("verweigert den Reset bei SSO, fehlendem Inhaber, laufender App oder ungültiger Passwortlänge", async () => {
    await expect(resetLocalOwnerPassword(database, password, true)).rejects.toThrow(/SSO-Modus/);
    await expect(resetLocalOwnerPassword(database, password, false)).rejects.toThrow(/keinen aktiven lokalen Inhaber/);
    await expect(resetLocalOwnerPassword(database, "kurz", false)).rejects.toThrow(/12 Zeichen/);
    await expect(resetLocalOwnerPassword(database, "x".repeat(129), false)).rejects.toThrow(/128 Zeichen/);
    await prepareLocalOwner(database, { userId: "sso", apply: true, password });
    await database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock_shared(${APP_RUNNING_LOCK})`;
      const other = postgres(testDatabaseUrl!, { max: 1 });
      try {
        await expect(resetLocalOwnerPassword(other, password, false)).rejects.toThrow(/stoppen/);
      } finally {
        await other.end();
      }
    });
  });
  it("behält Passwort und Sitzung, wenn der Reset nicht protokolliert werden kann", async () => {
    await prepareLocalOwner(database, { userId: "sso", apply: true, password });
    await database`insert into session(id,token,expires_at,user_id) values('owner-session','owner-token',now() + interval '1 hour','sso')`;
    const credentials = () => database`select password from account where user_id='sso' and provider_id='credential'`;
    const before = await credentials();
    await database`create function test_fail_reset_audit() returns trigger language plpgsql as $$
      begin
        if new.new_value->>'ereignis' = 'passwort_zurueckgesetzt' then raise exception 'Testfehler'; end if;
        return new;
      end $$`;
    await database`create trigger test_fail_reset_audit before insert on audit_log for each row execute function test_fail_reset_audit()`;
    try {
      await expect(resetLocalOwnerPassword(database, "ein-anderes-testpasswort", false)).rejects.toThrow(/Testfehler/);
    } finally {
      await database`drop trigger test_fail_reset_audit on audit_log`;
      await database`drop function test_fail_reset_audit()`;
    }
    expect(await credentials()).toEqual(before);
    expect(await database`select id from session where user_id='sso'`).toEqual([{ id: "owner-session" }]);
  });
  it("rollt Rolle, Credential und Nachweis bei einem Datenbankfehler zurück", async () => {
    await database`create function test_recovery_failure() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end; $$`;
    await database`create trigger test_recovery_failure before insert on account for each row execute function test_recovery_failure()`;
    try {
      await expect(prepareLocalOwner(database, { userId: "sso", apply: true, password })).rejects.toThrow(/test rollback/);
    } finally {
      await database`drop trigger test_recovery_failure on account`;
      await database`drop function test_recovery_failure()`;
    }
    expect((await database`select role from "user" where id='sso'`)[0]!.role).toBeNull();
    expect(await database`select id from account where provider_id='credential'`).toHaveLength(0);
  });
});
