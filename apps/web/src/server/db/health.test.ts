import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { createHealthCheck } from "./health.ts";

describe.skipIf(!testDatabaseUrl)("Healthcheck (Postgres)", () => {
  let client: postgres.Sql;

  beforeAll(async () => {
    client = await setupTestDb();
  });
  afterAll(async () => {
    await client?.end();
  });

  it("liefert bei erreichbarer, migrierter Datenbank nur den Status", async () => {
    const response = await createHealthCheck(client)();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("bricht eine blockierte Abfrage ab und prüft nach Freigabe erneut", async () => {
    const probe = postgres(testDatabaseUrl!, { max: 1 });
    const check = createHealthCheck(probe);
    try {
      const [backend] = await probe<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await client.begin(async (tx) => {
        await tx`lock table drizzle.__drizzle_migrations in access exclusive mode`;
        const response = await check();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "nicht bereit", grund: "datenbank" });
        await expect.poll(() => tx`select 1 from pg_locks where pid = ${backend!.pid} and not granted`).toHaveLength(0);
      });
      expect((await check()).status).toBe(200);
    } finally {
      await probe.end();
    }
  });

  it("meldet eine nicht erreichbare Datenbank ohne Verbindungsdetails", async () => {
    const unavailableUrl = new URL(testDatabaseUrl!);
    unavailableUrl.pathname += "_fehlt";
    const unavailable = postgres(unavailableUrl.toString(), { connect_timeout: 2 });
    try {
      const response = await createHealthCheck(unavailable)();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "nicht bereit", grund: "datenbank" });
    } finally {
      await unavailable.end();
    }
  });

  it("meldet eine ausstehende Migration bei erreichbarer Datenbank", async () => {
    await client`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`;
    const response = await createHealthCheck(client)();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "nicht bereit", grund: "migrationen" });
  });
});
