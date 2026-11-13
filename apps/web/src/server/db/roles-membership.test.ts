import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { grantApplicationAccess, readDatabaseAccess } from "./roles.ts";

describe.skipIf(!testDatabaseUrl)("Wirksame Rollenmitgliedschaften (Postgres, #619)", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let database: string;
  const prefix = `membership619_${process.pid}`;
  const appRole = `${prefix}_app`;
  let next = 0;

  // Echte Anmeldung: SET ROLE darf nicht versehentlich die Betreiberrechte des Tests verwenden.
  beforeAll(async () => {
    admin = await setupTestDb();
    const [context] = await admin`select current_database() as database`;
    database = context!.database;
    await admin`create role ${admin(appRole)} login password 'mitgliedschaft-test-619'`;
    await grantApplicationAccess(admin, { role: appRole, loginRole: appRole, database });
    const url = new URL(testDatabaseUrl!);
    url.username = appRole;
    url.password = "mitgliedschaft-test-619";
    app = postgres(url.toString(), { max: 1, onnotice: () => {} });
  }, 30_000);

  afterAll(async () => {
    await app?.end();
    if (!admin) return;
    await admin`drop owned by ${admin(appRole)}`;
    await admin`drop role ${admin(appRole)}`;
    await admin.end();
  });

  async function withRoles(run: (target: string, bridge: string, delegate: string) => Promise<void>) {
    const roles = ["target", "bridge", "delegate"].map((name) => `${prefix}_${next}_${name}`);
    next++;
    for (const role of roles) await admin`create role ${admin(role)}`;
    try {
      await run(roles[0]!, roles[1]!, roles[2]!);
    } finally {
      for (const role of roles) await admin`drop owned by ${admin(role)} cascade`;
      for (const role of roles) await admin`drop role ${admin(role)}`;
    }
  }

  async function expectRestricted(restricted: boolean) {
    const access = await readDatabaseAccess(app);
    expect(access, access.problems.join(" ")).toMatchObject({ role: appRole, loginRole: appRole, restricted });
    if (restricted) expect(access.problems).toEqual([]);
  }

  // PostgreSQL 18, Tabelle 9.72: MEMBER allein sagt nichts über wirksame Rechte aus.
  // https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE
  it("erlaubt eine Eigentümermitgliedschaft ohne INHERIT, SET und ADMIN", async () => {
    await withRoles(async (target, _bridge, delegate) => {
      await admin`create table public.membership619_owner (id integer)`;
      await admin`alter table public.membership619_owner owner to ${admin(target)}`;
      await admin`grant ${admin(target)} to ${admin(appRole)} with inherit false, set false, admin false`;
      expect(
        await app`select pg_has_role(current_user, ${target}, 'MEMBER') as member,
        pg_has_role(current_user, ${target}, 'USAGE') as inherited,
        pg_has_role(current_user, ${target}, 'SET') as settable`,
      ).toEqual([{ member: true, inherited: false, settable: false }]);
      await expect(app`alter table public.membership619_owner add column blocked integer`).rejects.toMatchObject({ code: "42501" });
      await expect(app`set role ${app(target)}`).rejects.toMatchObject({ code: "42501" });
      await expect(app`grant ${app(target)} to ${app(delegate)}`).rejects.toMatchObject({ code: "42501" });
      await expectRestricted(true);
      await grantApplicationAccess(admin, { role: appRole, loginRole: appRole, database });
    });
  });

  // Rollenattribute werden nicht vererbt, auch wenn Objektrechte vererbt werden.
  // https://www.postgresql.org/docs/18/role-membership.html
  it.each(["superuser", "createdb", "createrole", "replication", "bypassrls"])("erlaubt bloß geerbtes %s ohne SET", async (attribute) => {
    await withRoles(async (target) => {
      await admin.unsafe(`alter role "${target}" ${attribute}`);
      await admin`grant ${admin(target)} to ${admin(appRole)} with inherit true, set false, admin false`;
      expect(await app`select pg_has_role(current_user, ${target}, 'USAGE') as inherited`).toEqual([{ inherited: true }]);
      await expect(app`set role ${app(target)}`).rejects.toMatchObject({ code: "42501" });
      await expect(app`set session_replication_role = replica`).rejects.toMatchObject({ code: "42501" });
      await expectRestricted(true);
    });
  });

  it.each(["superuser", "createdb", "createrole", "replication", "bypassrls"])("weist per SET verfügbares %s zurück", async (attribute) => {
    await withRoles(async (target) => {
      await admin.unsafe(`alter role "${target}" ${attribute}`);
      await admin`grant ${admin(target)} to ${admin(appRole)} with inherit false, set true, admin false`;
      await app.begin(async (tx) => {
        await tx`set local role ${tx(target)}`;
        expect(await tx`select current_user as role`).toEqual([{ role: target }]);
      });
      await expectRestricted(false);
    });
  });

  it.each(["inherit", "set", "set-inherit"])("weist wirksames Eigentum über %s zurück", async (path) => {
    await withRoles(async (target, bridge) => {
      await admin`create table public.membership619_owner (id integer)`;
      await admin`alter table public.membership619_owner owner to ${admin(target)}`;
      if (path === "inherit") await admin`grant ${admin(target)} to ${admin(appRole)} with inherit true, set false`;
      if (path === "set") await admin`grant ${admin(target)} to ${admin(appRole)} with inherit false, set true`;
      if (path === "set-inherit") {
        await admin`grant ${admin(target)} to ${admin(bridge)} with inherit true, set false`;
        await admin`grant ${admin(bridge)} to ${admin(appRole)} with inherit false, set true`;
        expect(
          await app`select pg_has_role(current_user, ${target}, 'USAGE') as inherited,
          pg_has_role(current_user, ${target}, 'SET') as settable`,
        ).toEqual([{ inherited: false, settable: false }]);
      }
      const rollback = new Error("zurückgerollte Eigentümerprobe");
      await expect(
        app.begin(async (tx) => {
          if (path !== "inherit") await tx`set local role ${tx(path === "set" ? target : bridge)}`;
          await tx`alter table public.membership619_owner add column permitted integer`;
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      await expectRestricted(false);
    });
  });

  it.each(["create", "temporary", "replication", "files", "trigger"])("weist nach SET geerbtes %s mit echter Rechteprobe zurück", async (privilege) => {
    await withRoles(async (target, bridge) => {
      if (privilege === "create") await admin`grant create on schema public to ${admin(target)}`;
      if (privilege === "temporary") await admin`grant temporary on database ${admin(database)} to ${admin(target)}`;
      if (privilege === "replication") await admin`grant set on parameter session_replication_role to ${admin(target)}`;
      if (privilege === "files") {
        await admin`grant pg_read_server_files to ${admin(target)} with inherit true, set false`;
        await admin`grant execute on function pg_read_file(text) to ${admin(target)}`;
      }
      if (privilege === "trigger") {
        await admin`grant trigger on public.journal_entries to ${admin(target)}`;
        await admin`grant execute on function public.haben_audit() to ${admin(target)}`;
      }
      await admin`grant ${admin(target)} to ${admin(bridge)} with inherit true, set false`;
      await admin`grant ${admin(bridge)} to ${admin(appRole)} with inherit false, set true`;
      const rollback = new Error("zurückgerollte Objektrechteprobe");
      await expect(
        app.begin(async (tx) => {
          await tx`set local role ${tx(bridge)}`;
          if (privilege === "create") await tx`create table public.membership619_created (id integer)`;
          if (privilege === "temporary") await tx`create temp table membership619_temp (id integer)`;
          if (privilege === "replication") await tx`set local session_replication_role = replica`;
          if (privilege === "files") expect(await tx`select pg_read_file('/etc/hostname') as hostname`).toHaveLength(1);
          if (privilege === "trigger")
            await tx`create trigger membership619_trigger before insert on public.journal_entries
          for each row execute function public.haben_audit()`;
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      await expectRestricted(false);
    });
  });

  // GRANT braucht tatsächlich verfügbare ADMIN-Optionen; INHERIT und SET können dafür kombiniert werden.
  // https://www.postgresql.org/docs/18/sql-grant.html#SQL-GRANT-ROLES
  it.each(["direct", "inherit", "set-inherit"])("weist verfügbare ADMIN-Option über %s samt Selbsteskalation zurück", async (path) => {
    await withRoles(async (target, bridge, delegate) => {
      if (path === "direct") await admin`grant ${admin(target)} to ${admin(appRole)} with inherit false, set false, admin true`;
      else {
        await admin`grant ${admin(target)} to ${admin(delegate)} with inherit false, set false, admin true`;
        if (path === "inherit") await admin`grant ${admin(delegate)} to ${admin(appRole)} with inherit true, set false`;
        else {
          await admin`grant ${admin(delegate)} to ${admin(bridge)} with inherit true, set false`;
          await admin`grant ${admin(bridge)} to ${admin(appRole)} with inherit false, set true`;
        }
      }
      const rollback = new Error("zurückgerollte ADMIN-Eskalation");
      await expect(
        app.begin(async (tx) => {
          if (path === "set-inherit") await tx`set local role ${tx(bridge)}`;
          await tx`grant ${tx(target)} to ${tx(appRole)} with inherit true, set true`;
          expect(await tx`select pg_has_role(${appRole}, ${target}, 'SET') as settable`).toEqual([{ settable: true }]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      // Die Erweiterung wurde zurückgerollt: Bereits die ADMIN-Option muss genügen.
      await expectRestricted(false);
    });
  });

  it("erlaubt eine nicht verfügbare ADMIN-Option hinter inaktiver Mitgliedschaft", async () => {
    await withRoles(async (target, bridge, delegate) => {
      await admin`grant ${admin(target)} to ${admin(bridge)} with inherit false, set false, admin true`;
      await admin`grant ${admin(bridge)} to ${admin(appRole)} with inherit false, set false, admin false`;
      // pg_has_role(... WITH ADMIN OPTION) folgt auch MEMBER-Pfaden, die keine Rechte vermitteln.
      expect(await app`select pg_has_role(current_user, ${target}, 'MEMBER WITH ADMIN OPTION') as admin`).toEqual([{ admin: true }]);
      await expect(app`grant ${app(target)} to ${app(delegate)}`).rejects.toThrow();
      await expect(app`set role ${app(bridge)}`).rejects.toMatchObject({ code: "42501" });
      await expectRestricted(true);
    });
  });
});
