import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { grantApplicationAccess, readDatabaseAccess } from "./roles.ts";

describe.skipIf(!testDatabaseUrl)("Direkte Serverdateirechte (Postgres, #619)", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let database: string;
  let nullDevice: string;
  const appRole = `file619_${process.pid}`;
  const inheritedRole = `${appRole}_inherited`;
  const setRole = `${appRole}_set`;

  beforeAll(async () => {
    admin = await setupTestDb();
    const [context] = await admin`select current_database() as database`;
    database = context!.database;
    // Der Datenbankserver kann auf einem anderen Betriebssystem als der Testclient laufen.
    // https://www.postgresql.org/docs/18/view-pg-config.html
    const [server] = await admin`select setting as directory from pg_config where name = 'BINDIR'`;
    nullDevice = /^[A-Za-z]:[\\/]|^\\\\/.test(server!.directory) ? "NUL" : "/dev/null";
    await admin`create role ${admin(appRole)} login password 'dateirechte-test-619'`;
    await admin`create role ${admin(inheritedRole)}`;
    await admin`create role ${admin(setRole)}`;
    await grantApplicationAccess(admin, { role: appRole, loginRole: appRole, database, replicationMode: "origin" });
    const url = new URL(testDatabaseUrl!);
    url.username = appRole;
    url.password = "dateirechte-test-619";
    app = postgres(url.toString(), { max: 1, onnotice: () => {} });
  }, 30_000);

  afterAll(async () => {
    await app?.end();
    if (!admin) return;
    await admin`drop owned by ${admin(appRole)}`;
    await admin`drop owned by ${admin(inheritedRole)}`;
    await admin`drop owned by ${admin(setRole)}`;
    await admin`drop role ${admin(appRole)}`;
    await admin`drop role ${admin(inheritedRole)}`;
    await admin`drop role ${admin(setRole)}`;
    await admin.end();
  });

  // Auch einzelne EXECUTE-Grants öffnen Serverdateien, ohne Mitgliedschaft in den Dateirollen.
  // https://www.postgresql.org/docs/18/lo-funcs.html
  // https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-GENFILE
  it.each(
    [
      ["lo_import(text)", "select lo_import('PG_VERSION') as result"],
      ["lo_import(text,oid)", "select lo_import('PG_VERSION', 0) as result"],
      ["lo_export(oid,text)", ""],
      ["pg_read_file(text)", "select pg_read_file('PG_VERSION') as result"],
      ["pg_read_file(text,bigint,bigint)", "select pg_read_file('PG_VERSION', 0, 1) as result"],
      ["pg_read_file(text,bigint,bigint,boolean)", "select pg_read_file('PG_VERSION', 0, 1, false) as result"],
      ["pg_read_binary_file(text)", "select pg_read_binary_file('PG_VERSION') as result"],
      ["pg_read_binary_file(text,bigint,bigint)", "select pg_read_binary_file('PG_VERSION', 0, 1) as result"],
      ["pg_read_binary_file(text,bigint,bigint,boolean)", "select pg_read_binary_file('PG_VERSION', 0, 1, false) as result"],
    ].flatMap(([signature, statement]) => ["Diagnose", "Start"].map((mode) => ({ signature: signature!, statement: statement!, mode }))),
  )("weist direktes EXECUTE auf $signature nach echter Dateiprobe zurück ($mode)", async ({ signature, statement, mode }) => {
    await admin.unsafe(`grant execute on function pg_catalog.${signature} to "${appRole}"`);
    try {
      expect(
        await app`select pg_has_role(current_user, 'pg_read_server_files', 'USAGE') as reading,
        pg_has_role(current_user, 'pg_write_server_files', 'USAGE') as writing`,
      ).toEqual([{ reading: false, writing: false }]);
      const rollback = new Error("Dateiprobe zurückrollen");
      await expect(
        app.begin(async (tx) => {
          const [largeObject] = signature === "lo_export(oid,text)" ? await tx`select lo_from_bytea(0, convert_to('Rechteprobe', 'UTF8')) as id` : [];
          const [row] = largeObject ? await tx`select lo_export(${largeObject.id}, ${nullDevice}) as result` : await tx.unsafe(statement);
          expect(row!.result).toBeTruthy();
          // Das Nullgerät hält keine Datei zurück; importierte/generierte Large Objects werden zurückgerollt.
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      if (mode === "Diagnose") {
        const access = await readDatabaseAccess(app);
        expect(access, access.problems.join(" ")).toMatchObject({ restricted: false });
      } else {
        await expect(grantApplicationAccess(admin, { role: appRole, loginRole: appRole, database, replicationMode: "origin" })).rejects.toThrow(
          "nicht eingeschränkt",
        );
      }
    } finally {
      await admin.unsafe(`revoke execute on function pg_catalog.${signature} from "${appRole}"`);
    }
  });

  it.each(["inherit", "set-inherit", "public"])("weist wirksames Datei-EXECUTE über %s zurück", async (path) => {
    const recipient = path === "public" ? "public" : `"${inheritedRole}"`;
    await admin.unsafe(`grant execute on function pg_catalog.lo_export(oid,text) to ${recipient}`);
    if (path === "inherit") await admin`grant ${admin(inheritedRole)} to ${admin(appRole)} with inherit true, set false`;
    if (path === "set-inherit") {
      await admin`grant ${admin(inheritedRole)} to ${admin(setRole)} with inherit true, set false`;
      await admin`grant ${admin(setRole)} to ${admin(appRole)} with inherit false, set true`;
    }
    try {
      const rollback = new Error("Dateiprobe zurückrollen");
      await expect(
        app.begin(async (tx) => {
          if (path === "set-inherit") await tx`set local role ${tx(setRole)}`;
          const [largeObject] = await tx`select lo_from_bytea(0, convert_to('Rechteprobe', 'UTF8')) as id`;
          expect(await tx`select lo_export(${largeObject!.id}, ${nullDevice}) as result`).toEqual([{ result: 1 }]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await readDatabaseAccess(app)).toMatchObject({ restricted: false });
      await expect(grantApplicationAccess(admin, { role: appRole, loginRole: appRole, database, replicationMode: "origin" })).rejects.toThrow(
        "nicht eingeschränkt",
      );
    } finally {
      await admin.unsafe(`revoke execute on function pg_catalog.lo_export(oid,text) from ${recipient}`);
      if (path === "inherit") await admin`revoke ${admin(inheritedRole)} from ${admin(appRole)}`;
      if (path === "set-inherit") {
        await admin`revoke ${admin(setRole)} from ${admin(appRole)}`;
        await admin`revoke ${admin(inheritedRole)} from ${admin(setRole)}`;
      }
    }
  });
});
