import { copyFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { readAppVersion } from "./app-version.ts";
import { readDatabaseAccess } from "./roles.ts";

describe.skipIf(!testDatabaseUrl)("Migration und echte App-Anmeldung (Postgres, #619)", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  const appRole = `role619-app-${process.pid}`;
  const externalOwner = `role619_owner_${process.pid}`;
  const externalDb = `role619_external_${process.pid}`;
  let appUrl: string;
  let started: Promise<void> | undefined;

  const loginUrl = (role: string, database?: string) => {
    const url = new URL(testDatabaseUrl!);
    url.username = role;
    url.password = "rollen-test-619";
    if (database) url.pathname = `/${database}`;
    return url.toString();
  };

  async function migrate(runtimeUrl: string, migrationUrl?: string, script = fileURLToPath(new URL("./migrate.ts", import.meta.url)), expectedExit = 0) {
    // Vitest läuft unter Bun; derselbe Interpreter führt auch die echte CLI aus.
    const child = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: runtimeUrl, MIGRATION_DATABASE_URL: migrationUrl ?? "" },
      encoding: "utf-8",
      timeout: 15_000,
    });
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(expectedExit);
    expect(`${child.stdout}\n${child.stderr}`).not.toContain("rollen-test-619");
  }

  // Alle Rechteproben gehen erst durch den echten CLI-Start, nicht durch eine im Test vorab abgesicherte Rolle.
  const start = () => (started ??= migrate(appUrl, testDatabaseUrl));

  async function withReplicaDefault(check: (connection: postgres.Sql) => Promise<void>) {
    await start();
    // Ein Betreiber darf einen privilegierten Login-Default setzen, ohne der App das SET-Recht zu geben.
    // https://www.postgresql.org/docs/18/sql-alterrole.html
    await admin`alter role ${admin(appRole)} set session_replication_role = replica`;
    const connection = postgres(appUrl, { max: 1, onnotice: () => {} });
    try {
      expect(
        await connection`select current_setting('session_replication_role') as mode,
        has_parameter_privilege(current_user, 'session_replication_role', 'SET') as "canSet"`,
      ).toEqual([{ mode: "replica", canSet: false }]);
      await check(connection);
    } finally {
      await connection.end();
      await admin`alter role ${admin(appRole)} reset session_replication_role`;
    }
  }

  function futureMigration(statement: string, when = 9_000_000_000_000): string {
    const fixture = mkdtempSync(join(tmpdir(), "haben-migration-619-"));
    const source = fileURLToPath(new URL("./", import.meta.url));
    const db = join(fixture, "src/server/db");
    const meta = join(fixture, "drizzle/meta");
    mkdirSync(db, { recursive: true });
    mkdirSync(meta, { recursive: true });
    for (const name of ["migrate.ts", "roles.ts", "app-version.ts"]) if (existsSync(join(source, name))) copyFileSync(join(source, name), join(db, name));
    symlinkSync(fileURLToPath(new URL("../../../node_modules", import.meta.url)), join(fixture, "node_modules"), "junction");
    // Nur eine synthetische Folgemigration; der ausgelieferte Migrationsbestand bleibt unverändert.
    writeFileSync(
      join(meta, "_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when, tag: "0000_role619_future", breakpoints: false }] }),
    );
    writeFileSync(join(fixture, "drizzle/0000_role619_future.sql"), statement);
    return join(db, "migrate.ts");
  }

  beforeAll(async () => {
    admin = await setupTestDb();
    await admin`create role ${admin(appRole)} login password 'rollen-test-619' nosuperuser nocreatedb nocreaterole`;
    await admin`create role ${admin(externalOwner)} login password 'rollen-test-619' nosuperuser nocreatedb nocreaterole`;
    await admin`create database ${admin(externalDb)} owner ${admin(externalOwner)}`;
    appUrl = loginUrl(appRole);
    app = postgres(appUrl, { max: 1, onnotice: () => {} });
  }, 30_000);

  afterAll(async () => {
    await app?.end();
    if (!admin) return;
    await admin`drop database if exists ${admin(externalDb)} with (force)`;
    await admin`drop owned by ${admin(appRole)}`;
    await admin`drop role if exists ${admin(appRole)}`;
    await admin`drop role if exists ${admin(externalOwner)}`;
    await admin.end();
  });

  it("verwendet die Eigentümerverbindung für die Migration und lässt den bisherigen Einrollenstart zu", async () => {
    await migrate(testDatabaseUrl!);
    expect(await admin`select version, note from app_versions`).toEqual([{ version: readAppVersion(), note: null }]);
    await start();
    expect(await app`select current_user as role, session_user as login`).toEqual([{ role: appRole, login: appRole }]);
  });

  it("sperrt DDL, Replikationsparameter, Eigentümerwechsel und Schattenrelationen für die echte App-Anmeldung", async () => {
    await start();
    const [owner] = await admin`select current_user as name`;
    const rollback = new Error("nur zurückgerollte Rechteprobe");
    const statements = [
      "alter table public.journal_lines disable trigger journal_lines_locked",
      "set local session_replication_role = replica",
      "alter table public.journal_lines add column role619_probe integer",
      "drop table public.journal_lines cascade",
      "alter function public.haben_audit() rename to role619_probe",
      "drop function public.haben_audit() cascade",
      "create temp table audit_log (id integer)",
      "create table public.role619_probe (id integer)",
      `set role "${owner!.name.replaceAll('"', '""')}"`,
    ];
    for (const statement of statements) {
      await expect(
        app.begin(async (tx) => {
          await tx.unsafe(statement);
          throw rollback;
        }),
        statement,
      ).rejects.toMatchObject({ code: "42501" });
    }
    await app`reset role`;
    expect(await app`select current_user as role`).toEqual([{ role: appRole }]);
  });

  it("erlaubt Buchung, Audit und Siegel weiter, ohne die Festschreibung aufzuheben", async () => {
    await start();
    const entry = await app.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'rollen-test-619', true)`;
      await tx`insert into company (id, name, kontenrahmen) values (1, 'Rollen-Testfirma', 'SKR03') on conflict (id) do nothing`;
      const [row] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-01-10', 'Rechteprobe', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        values (${row!.id}, '4920', 10000, 0), (${row!.id}, '1200', 0, 10000)`;
      await tx`update journal_entries set locked_at = now() where id = ${row!.id}`;
      return row!.id as string;
    });
    expect(await app`select actor from audit_log where table_name = 'journal_entries' and row_id = ${entry}`).toEqual([
      { actor: "rollen-test-619" },
      { actor: "rollen-test-619" },
    ]);
    expect(await app`select table_name from seals where row_id = ${entry}`).toEqual([{ table_name: "journal_entries" }]);
    await expect(app`update journal_lines set debit = 1 where entry_id = ${entry} and debit > 0`).rejects.toThrow();
    expect(await app`select * from haben_integrity_problems()`).toEqual([]);
  });

  it("vergibt nach einer weiteren echten Migration Tabellen- und Sequenzrechte erneut", async () => {
    await start();
    await migrate(appUrl, testDatabaseUrl, futureMigration("create table public.role619_future (id bigserial primary key, value text not null);"));
    expect(await app`insert into role619_future (value) values ('neue Tabelle') returning id, value`).toEqual([{ id: "1", value: "neue Tabelle" }]);
    await migrate(appUrl, testDatabaseUrl);
    expect(await app`insert into role619_future (value) values ('erneuter Start') returning id`).toEqual([{ id: "2" }]);
  });

  it("migriert mit einer extern verwalteten Eigentümerrolle ohne Superuser und CREATEROLE", async () => {
    await migrate(loginUrl(appRole, externalDb), loginUrl(externalOwner, externalDb));
    const external = postgres(loginUrl(appRole, externalDb), { max: 1, onnotice: () => {} });
    try {
      expect(await external`select count(*)::integer as n from journal_entries`).toEqual([{ n: 0 }]);
      expect(await external`select current_user as role`).toEqual([{ role: appRole }]);
      expect(await external`select version, note from app_versions`).toEqual([{ version: readAppVersion(), note: null }]);
      expect(await external`select * from haben_integrity_problems()`).toEqual([]);
    } finally {
      await external.end();
    }
  }, 30_000);

  it("startet bei ausdrücklich konfigurierter, aber identischer Eigentümer-/App-Anmeldung nicht weiter", async () => {
    await migrate(testDatabaseUrl!, testDatabaseUrl!, undefined, 1);
  });

  it("prüft eine falsche App-Anmeldung vor dem ersten DDL der Migration", async () => {
    const script = futureMigration("create table public.role619_wrong_start (id integer);", 9_000_000_000_001);
    await migrate(testDatabaseUrl!, testDatabaseUrl!, script, 1);
    expect(await admin`select to_regclass('public.role619_wrong_start')::text as name`).toEqual([{ name: null }]);
  });

  it("meldet eine Login-Vorgabe mit ausgeschalteten Triggern trotz fehlendem SET-Recht", async () => {
    await withReplicaDefault(async (connection) => {
      const access = await readDatabaseAccess(connection);
      expect(access.restricted).toBe(false);
      expect(access.problems.join(" ")).toContain("Replikationsmodus");
    });
  });

  it("weist eine Login-Vorgabe mit ausgeschalteten Triggern vor dem ersten Migrations-DDL zurück", async () => {
    const script = futureMigration("create table public.role619_replica_default (id integer);", 9_000_000_000_002);
    try {
      await withReplicaDefault(async () => {
        await migrate(appUrl, testDatabaseUrl, script, 1);
        expect(await admin`select to_regclass('public.role619_replica_default')::text as name`).toEqual([{ name: null }]);
      });
    } finally {
      await admin`drop table if exists public.role619_replica_default`;
    }
  });

  it.each(["owner", "replication", "temporary", "schema"] as const)("weist eine nachträglich unsichere App-Rolle zurück: %s", async (kind) => {
    await start();
    const [context] = await admin`select current_user as owner, current_database() as database`;
    if (kind === "owner") await admin`grant ${admin(context!.owner)} to ${admin(appRole)} with inherit false`;
    if (kind === "replication") await admin`grant set on parameter session_replication_role to ${admin(appRole)}`;
    if (kind === "temporary") await admin`grant temporary on database ${admin(context!.database)} to ${admin(appRole)}`;
    const ownSchema = `pga619_${process.pid}`;
    if (kind === "schema") await admin`create schema ${admin(ownSchema)} authorization ${admin(appRole)}`;
    const probe = postgres(appUrl, { max: 1, onnotice: () => {} });
    try {
      const rollback = new Error("nur zurückgerollte Gegenprobe");
      await expect(
        probe.begin(async (tx) => {
          if (kind === "owner") {
            await tx`set role ${tx(context!.owner)}`;
            expect(await tx`select current_user as role`).toEqual([{ role: context!.owner }]);
          }
          if (kind === "replication") {
            await tx`set local session_replication_role = replica`;
            expect(await tx`select current_setting('session_replication_role') as mode`).toEqual([{ mode: "replica" }]);
          }
          if (kind === "temporary") await tx`create temp table audit_log (id integer)`;
          if (kind === "schema") await tx`create table ${tx(ownSchema)}.audit_log (id integer)`;
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      await migrate(appUrl, testDatabaseUrl, undefined, 1);
    } finally {
      await probe.end();
      if (kind === "owner") await admin`revoke ${admin(context!.owner)} from ${admin(appRole)}`;
      if (kind === "replication") await admin`revoke set on parameter session_replication_role from ${admin(appRole)}`;
      if (kind === "temporary") await admin`revoke temporary on database ${admin(context!.database)} from ${admin(appRole)}`;
      if (kind === "schema") await admin`drop schema ${admin(ownSchema)} cascade`;
    }
    await migrate(appUrl, testDatabaseUrl);
  });
});
