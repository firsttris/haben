import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_RUNNING_LOCK } from "./db/app-lock.ts";
import { prepareLocalOwner } from "./db/local-owner.ts";
import { ssoTakeover } from "./db/sso-uebernahme.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Sperre der laufenden App nach Verbindungsabbruch (Postgres)", () => {
  let database: postgres.Sql;
  let admin: postgres.Sql;
  let hold: typeof import("./sso-mode.ts").holdAppRunningLock;
  const userId = "owner-lock-1094";
  const issuer = "https://lock-test.invalid";
  const databaseName = new URL(testDatabaseUrl ?? "postgres://localhost/test").pathname.slice(1);

  beforeAll(async () => {
    database = await setupTestDb();
    admin = postgres(Object.assign(new URL(testDatabaseUrl!), { pathname: "/postgres" }).toString(), { max: 1 });
    ({ holdAppRunningLock: hold } = await import("./sso-mode.ts"));
    await database`insert into "user" (id, name, email, role) values (${userId}, 'Inhaberin', 'lock@example.invalid', null)`;
  }, 60_000);

  afterAll(async () => {
    await admin?.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections true`);
    await database?.end();
    await admin?.end();
    await (await import("./db/index.ts")).closeDatabase();
  });

  async function lockPid(): Promise<number | null> {
    const [lock] = await database<{ pid: number }[]>`
      select pid from pg_locks where locktype = 'advisory' and granted and mode = 'ShareLock'
      and database = (select oid from pg_database where datname = current_database())
      and classid = ${Math.floor(APP_RUNNING_LOCK / 2 ** 32)}::oid
      and objid = ${APP_RUNNING_LOCK % 2 ** 32}::oid and objsubid = 1`;
    return lock?.pid ?? null;
  }

  function cli(script: string, args: string[]) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl!, OIDC_ISSUER: issuer },
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(child.error).toBeUndefined();
    return child;
  }

  async function guards(refused: boolean) {
    const takeover = await ssoTakeover(database, { userId, issuer, subject: "owner", apply: false }, issuer);
    if (refused) {
      expect(takeover).toMatchObject({ ok: false, message: expect.stringMatching(/läuft noch/) });
      await expect(prepareLocalOwner(database, { userId, apply: false })).rejects.toThrow(/stoppen/);
    } else {
      expect(takeover).toMatchObject({ ok: true, applied: false });
      expect(await prepareLocalOwner(database, { userId, apply: false })).toMatchObject({ applied: false });
    }
    const sso = cli("./db/sso-uebernahme.ts", ["--konto", userId, "--subject", "owner"]);
    expect(sso.status, `${sso.stdout}\n${sso.stderr}`).toBe(refused ? 1 : 0);
    const local = cli("./db/local-owner.ts", ["--konto", userId]);
    expect(local.status, `${local.stdout}\n${local.stderr}`).toBe(refused ? 1 : 0);
    expect(await database`select id from sso_takeovers`).toHaveLength(0);
    expect(await database`select id from local_owner_recoveries`).toHaveLength(0);
  }

  it("nimmt die Sperre innerhalb von zehn Sekunden auf neuer PID und sperrt beide echten CLIs wieder", async () => {
    // Dieselben gültigen Argumente müssen ohne laufende App durchgehen; sonst wäre ein Parameterfehler ein falsches Grün.
    await guards(false);
    const release = await hold();
    try {
      await guards(true);
      const previous = await lockPid();
      expect(previous).not.toBeNull();
      await database`select pg_terminate_backend(${previous!})`;
      await expect
        .poll(
          async () => {
            const pid = await lockPid();
            return pid !== null && pid !== previous;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      await guards(true);
    } finally {
      await release();
    }
    expect(await lockPid()).toBeNull();
    await guards(false);
  }, 15_000);

  it("versucht nach längerem Ausfall weiter, meldet ihn und nimmt die Sperre nach Erholung neu", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const release = await hold();
    try {
      const previous = await lockPid();
      expect(previous).not.toBeNull();
      // Nur diese Worker-Datenbank lehnt neue Sitzungen ab; die bestehende Kontrollverbindung bleibt erreichbar.
      await admin.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections false`);
      await database`select pg_terminate_backend(${previous!})`;
      await expect.poll(() => warning.mock.calls.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
      expect(await lockPid()).toBeNull();
      await admin.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections true`);
      await expect.poll(lockPid, { timeout: 10_000 }).not.toBeNull();
      await guards(true);
    } finally {
      await admin.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections true`);
      await release();
      warning.mockRestore();
    }
    expect(await lockPid()).toBeNull();
  }, 25_000);

  it("beendet die Wiederverbindung auch während eines Ausfalls und lässt beide CLIs danach wieder zu", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const release = await hold();
    try {
      const pid = await lockPid();
      expect(pid).not.toBeNull();
      await admin.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections false`);
      await database`select pg_terminate_backend(${pid!})`;
      await expect.poll(() => warning.mock.calls.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    } finally {
      // Der Close-Hook muss bei weiterhin gesperrter Datenbank enden können.
      try {
        await release();
      } finally {
        await admin.unsafe(`alter database "${databaseName.replaceAll('"', '""')}" allow_connections true`);
        warning.mockRestore();
      }
    }
    expect(await lockPid()).toBeNull();
    expect(await database`select pid from pg_stat_activity where datname = ${databaseName} and pid <> pg_backend_pid()`).toHaveLength(0);
    await guards(false);
  }, 15_000);
});
