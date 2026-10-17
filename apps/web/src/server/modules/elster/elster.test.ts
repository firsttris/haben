import type postgres from "postgres";
import { FakeElsterClient } from "@haben/elster";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Datenschutzhinweise der Finanzverwaltung vor der Nutzung von ERiC (Postgres)", () => {
  let elster: typeof import("./elster.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    elster = await import("./elster.ts");
    await sql`truncate company cascade`;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("sperrt jeden ERiC-Aufruf bis zur Bestätigung und protokolliert sie", async () => {
    const inner = new FakeElsterClient();
    const client = elster.mitDatenschutzPruefung(inner, elster.requireElsterDatenschutz);
    // Eigenschaften ohne Aufruf reichen durch, z. B. die Kennung des simulierten Clients
    expect("isFake" in client && client.isFake).toBe(true);
    await expect(client.validate("<Elster/>")).rejects.toThrow(/Datenschutzhinweise/);
    expect((await elster.ericStatus()).datenschutzBestaetigt).toBeNull();

    await elster.confirmElsterDatenschutz("test-user");
    expect((await elster.ericStatus()).datenschutzBestaetigt).not.toBeNull();
    await expect(client.validate("<Elster/>")).resolves.toHaveProperty("ok");
    const [audit] = await sql`select actor from audit_log where table_name = 'company' order by id desc limit 1`;
    expect(audit?.actor).toBe("test-user");
  });
});
