import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { APP_RUNNING_LOCK } from "./app-lock.ts";
import { prepareLocalOwner } from "./local-owner.ts";

describe.skipIf(!testDatabaseUrl)("Offline-Rückweg aus SSO (Postgres)", () => {
  let database: postgres.Sql;
  const password = "ein-neues-lokales-passwort";
  beforeAll(async () => {
    vi.stubEnv("OIDC_ONLY", "false");
    database = await setupTestDb();
  }, 60_000);
  beforeEach(async () => {
    await database`truncate "user" cascade`;
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
