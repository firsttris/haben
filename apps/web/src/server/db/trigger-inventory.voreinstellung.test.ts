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
      const [{ mode }] = await fresh`select current_setting('session_replication_role') as mode`;
      expect(mode).toBe("replica");
      const rollback = new Error("zurückrollen");
      let deleted = 0;
      await expect(
        fresh.begin(async (tx) => {
          [{ deleted }] = (await tx`with d as (delete from audit_log returning 1) select count(*)::int as deleted from d`) as unknown as [
            { deleted: number },
          ];
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
});
