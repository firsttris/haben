import type postgres from "postgres";

type Reader = postgres.Sql | postgres.TransactionSql;

export interface DatabaseAccessInfo {
  role: string;
  loginRole: string;
  restricted: boolean;
  problems: string[];
}

interface Identity {
  role: string;
  loginRole: string;
  database: string;
}

/** Eine echte Anmeldung statt SET ROLE: RESET ROLE darf keinen Eigentümerzugang eröffnen. */
async function identity(sql: Reader): Promise<Identity> {
  const [row] = await sql<Identity[]>`select current_user as role, session_user as "loginRole", current_database() as database`;
  return row!;
}

/**
 * PostgreSQL-Rechte schließen PUBLIC und erreichbare Rollen ein, nicht nur die direkten Grants.
 * https://www.postgresql.org/docs/18/role-membership.html
 * https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE
 * Eigentümer kommen aus dem Katalog statt aus einer Liste von Objekttypen oder Schema-Präfixen:
 * https://www.postgresql.org/docs/18/catalog-pg-shdepend.html
 */
async function accessFor(sql: Reader, who: Identity): Promise<DatabaseAccessInfo> {
  const [rights] = await sql<
    {
      admin: boolean;
      owner: boolean;
      createObjects: boolean;
      temporary: boolean;
      replication: boolean;
      files: boolean;
      triggers: boolean;
    }[]
  >`with reachable as (
      select r.* from pg_roles r join pg_roles login on login.rolname = ${who.loginRole}
      where pg_has_role(login.oid, r.oid, 'MEMBER')
    ), schemas as (
      select oid from pg_namespace
    ), owners as (
      select datdba as oid from pg_database where datname = current_database()
      union select refobjid from pg_shdepend where refclassid = 'pg_authid'::regclass and deptype = 'o'
        and dbid = (select oid from pg_database where datname = current_database())
    ) select
      exists(select 1 from reachable where rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls) as admin,
      exists(select 1 from reachable r join owners o on o.oid = r.oid) as owner,
      exists(select 1 from reachable r where has_database_privilege(r.oid, current_database(), 'CREATE'))
        or exists(select 1 from reachable r cross join schemas s where has_schema_privilege(r.oid, s.oid, 'CREATE')) as "createObjects",
      exists(select 1 from reachable r where has_database_privilege(r.oid, current_database(), 'TEMP')) as temporary,
      exists(select 1 from reachable r where has_parameter_privilege(r.oid, 'session_replication_role', 'SET,ALTER SYSTEM')) as replication,
      exists(select 1 from reachable where rolname in ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')) as files,
      exists(select 1 from reachable r cross join pg_class c where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'f') and has_table_privilege(r.oid, c.oid, 'TRIGGER')) as triggers`;
  const problems: string[] = [];
  if (who.role !== who.loginRole) problems.push("Die Sitzung verwendet einen Rollenwechsel statt einer eigenen App-Anmeldung.");
  if (rights!.admin) {
    problems.push("Die Anmeldung oder eine erreichbare Rolle hat administrative Datenbankrechte.");
  } else if (rights!.owner) {
    problems.push("Die Anmeldung hat Eigentümerrechte an der Datenbank oder an Anwendungsobjekten.");
  } else {
    if (rights!.createObjects) problems.push("Die Anmeldung kann Datenbankobjekte anlegen.");
    if (rights!.temporary) problems.push("Die Anmeldung kann temporäre Tabellen anlegen und damit Namen in Triggerfunktionen überdecken.");
    if (rights!.replication) problems.push("Die Anmeldung kann den Replikationsmodus und damit die Ausführung von Triggern ändern.");
    if (rights!.files) problems.push("Die Anmeldung hat Zugriff auf Serverdateien oder externe Programme.");
    if (rights!.triggers) problems.push("Die Anmeldung kann Trigger anlegen.");
  }
  return { role: who.role, loginRole: who.loginRole, restricted: problems.length === 0, problems };
}

/** Nur tatsächlich wirksame Rechte, keine Verbindungsadresse oder Migrationskonfiguration zurückgeben. */
export async function readDatabaseAccess(sql: Reader): Promise<DatabaseAccessInfo> {
  return accessFor(sql, await identity(sql));
}

/** Beide echten Anmeldungen vor dem ersten Migrations-DDL unter der bereits gehaltenen Sitzungssperre prüfen. */
export async function checkApplicationConnection(owner: postgres.Sql, application: postgres.Sql, migrationLock: number): Promise<Identity> {
  const migration = await identity(owner);
  const app = await identity(application);
  if (app.role !== app.loginRole || app.loginRole === migration.loginRole) {
    throw new Error("App und Migration müssen unterschiedliche echte Datenbankanmeldungen verwenden.");
  }
  const [backend] = await owner<{ pid: number }[]>`select pg_backend_pid() as pid`;
  // Dieselbe Datenbank muss die bereits gehaltene Migrationssperre sehen, auch über einen anderen Verbindungsweg.
  // pg_locks ist ohne Eigentümer-/Superuserrechte lesbar: https://www.postgresql.org/docs/18/view-pg-locks.html
  const [proof] = await application<{ same: boolean }[]>`select exists(select 1 from pg_locks
    where locktype = 'advisory' and pid = ${backend!.pid} and granted and objsubid = 1
      and classid = (${migrationLock}::bigint >> 32)::oid and objid = (${migrationLock}::bigint & 4294967295)::oid
      and database = (select oid from pg_database where datname = current_database())) as same`;
  if (app.database !== migration.database || !proof!.same) throw new Error("App und Migration müssen dieselbe Datenbank verwenden.");
  return app;
}

/**
 * Nach jeder Migration unter deren Sitzungssperre; Rollen und Kennwörter verwaltet der Betreiber.
 * TEMP/CREATE aus PUBLIC würden unqualifizierte Triggernamen überdecken, auch ohne Eigentümerrechte:
 * https://www.postgresql.org/docs/18/ddl-schemas.html
 * https://www.postgresql.org/docs/18/sql-grant.html
 */
export async function grantApplicationAccess(owner: postgres.Sql, app: Identity): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`revoke create on schema public from public`;
    await tx`revoke temporary on database ${tx(app.database)} from public`;
    await tx`grant connect on database ${tx(app.database)} to ${tx(app.loginRole)}`;
    await tx`grant usage on schema public to ${tx(app.loginRole)}`;
    await tx`grant select, insert, update, delete on all tables in schema public to ${tx(app.loginRole)}`;
    await tx`grant usage on all sequences in schema public to ${tx(app.loginRole)}`;
    // Ein externer, nicht privilegierter Eigentümer darf nur seine Funktionen freigeben, nicht z.B. pgcrypto ändern.
    const grants = await tx<
      { statement: string }[]
    >`select format('grant execute on function %s to %I', p.oid::regprocedure, ${app.loginRole}::text) as statement
      from pg_proc p where p.pronamespace = 'public'::regnamespace and pg_has_role(current_user, p.proowner, 'USAGE')`;
    for (const grant of grants) await tx.unsafe(grant.statement);
    const access = await accessFor(tx, app);
    if (!access.restricted) throw new Error(`Die App-Anmeldung ist nicht eingeschränkt: ${access.problems.join(" ")}`);
  });
}
