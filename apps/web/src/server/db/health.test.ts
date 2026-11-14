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

  it("meldet eine ausstehende Migration bei erreichbarer Datenbank", async () => {
    await client`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`;
    const response = await createHealthCheck(client)();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "nicht bereit", grund: "migrationen" });
  });

  it("antwortet auch bei einer blockierten Abfrage mit 503", async () => {
    const check = createHealthCheck(client);
    await client.begin(async (tx) => {
      await tx`lock table drizzle.__drizzle_migrations in access exclusive mode`;
      const response = await check();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "nicht bereit", grund: "datenbank" });
    });
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
});
