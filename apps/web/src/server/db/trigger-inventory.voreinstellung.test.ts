import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

// Gegenprobe aus dem korrigierten Review; ausschließlich die eigene Worker-Datenbank verändern.
// https://github.com/firsttris/haben/pull/874#issuecomment-6869530241
// https://www.postgresql.org/docs/18/sql-alterdatabase.html
describe.skipIf(!testDatabaseUrl)("Sperrprüfung und dauerhafte Voreinstellungen der Datenbank (Postgres, #764)", () => {
  let sql: postgres.Sql;
  let database: string;
  let inventory: typeof import("./trigger-inventory.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    inventory = await import("./trigger-inventory.ts");
    [{ database }] = (await sql`select current_database() as database`) as unknown as [{ database: string }];
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it("meldet session_replication_role = replica als Voreinstellung der Datenbank, unter der die Sperren nicht feuern", async () => {
    await sql`alter database ${sql(database)} set session_replication_role = replica`;
    const fresh = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      // Die Sperre bleibt im Katalog auf O; nur die Wirkung ist in neuen Verbindungen aufgehoben.
      const [setting] = await fresh<{ mode: string }[]>`select current_setting('session_replication_role') as mode`;
      expect(setting?.mode).toBe("replica");
      const rollback = new Error("zurückrollen");
      let deleted = 0;
      await expect(
        fresh.begin(async (tx) => {
          [{ deleted }] = (await tx`with d as (delete from audit_log returning 1) select count(*)::int as deleted from d`) as unknown as [{ deleted: number }];
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(deleted).toBeGreaterThan(0);
      expect((await inventory.checkTriggerIntegrity(drizzle(fresh))).problems).not.toEqual([]);
    } finally {
      await fresh.end();
      await sql`alter database ${sql(database)} reset session_replication_role`;
    }
  });

  it.each([false, true])("meldet eine Rollenvorgabe auch außerhalb der prüfenden Rolle (datenbankgebunden: %s)", async (inDatabase) => {
    const role = `haben_replica_${crypto.randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("Rollenvorgabe zurückrollen");
    await expect(
      drizzle(sql).transaction(async (tx) => {
        await tx.execute(query`create role ${query.identifier(role)} nologin`);
        await tx.execute(
          inDatabase
            ? query`alter role ${query.identifier(role)} in database ${query.identifier(database)} set session_replication_role = replica`
            : query`alter role ${query.identifier(role)} set session_replication_role = replica`,
        );
        expect(await tx.execute(query`select current_setting('session_replication_role') as mode`)).toEqual([{ mode: "origin" }]);
        expect((await inventory.checkTriggerIntegrity(tx)).problems).toContainEqual(
          expect.objectContaining({ art: "sperre", befund: expect.stringContaining(role) }),
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("akzeptiert local und ignoriert Vorgaben einer anderen Testdatenbank", async () => {
    const otherDatabase = decodeURIComponent(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
    expect(otherDatabase).not.toBe(database);
    const rollback = new Error("Vorgaben zurückrollen");
    await expect(
      drizzle(sql).transaction(async (tx) => {
        // ALTER DATABASE und ALTER ROLE sind transaktional: andere Testdateien sehen diese Vorgaben nie.
        await tx.execute(query`alter database ${query.identifier(otherDatabase)} set session_replication_role = replica`);
        await tx.execute(query`alter database ${query.identifier(database)} set session_replication_role = local`);
        expect((await inventory.checkTriggerIntegrity(tx)).problems).toEqual([]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
import { sql as query } from "drizzle-orm";
