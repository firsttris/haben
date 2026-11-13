import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer } from "./durchlaeufe.ts";

/** Der optionale App-Modus muss den echten Server mit der eingeschränkten Anmeldung betreiben. */
test("der Server verbindet sich mit der eingeschränkten App-Anmeldung", async ({ request }) => {
  test.skip(!process.env.E2E_APP_DATABASE_URL, "braucht E2E_APP_DATABASE_URL für den eingeschränkten App-Modus");
  const appRole = decodeURIComponent(new URL(process.env.E2E_APP_DATABASE_URL!).username);
  const sql = postgres(databaseUrlFuer(), { max: 1 });
  try {
    const response = await request.get("/login");
    expect(response.status()).toBeLessThan(500);
    // pg_stat_activity zeigt die Anmeldung der echten Verbindungen, unabhängig von SET ROLE:
    // https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW
    await expect
      .poll(async () => {
        const sessions = await sql`select distinct usename from pg_stat_activity
          where datname = current_database() and application_name = 'haben-e2e-ablauf' and backend_type = 'client backend'`;
        return sessions.map((session) => session.usename);
      })
      .toEqual([appRole]);
    const [role] = await sql`select rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      from pg_roles where rolname = ${appRole}`;
    expect(role).toEqual({ rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false });
  } finally {
    await sql.end();
  }
});
