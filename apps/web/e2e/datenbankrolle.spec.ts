import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    const [role] = await sql`select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      from pg_roles where rolname = ${appRole}`;
    expect(role).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false });
  } finally {
    await sql.end();
  }
});

test("der Serverstart lädt keine privaten Datenbankadressen aus .env nach", async () => {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "haben-e2e-umgebung-"));
  try {
    await writeFile(
      join(directory, ".env"),
      [
        "MIGRATION_DATABASE_URL=postgres://dotenv-owner:erfunden@localhost/haben_e2e",
        "E2E_DATABASE_URL=postgres://dotenv-fixture:erfunden@localhost/haben_e2e",
        "E2E_APP_DATABASE_URL=postgres://dotenv-app:erfunden@localhost/haben_e2e",
        "HABEN_SETUP_CODE=dotenv-bleibt-wirksam",
      ].join("\n"),
    );
    await writeFile(
      join(directory, "environment-probe.ts"),
      `console.log(JSON.stringify({
        MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
        E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
        E2E_APP_DATABASE_URL: process.env.E2E_APP_DATABASE_URL,
        HABEN_SETUP_CODE: process.env.HABEN_SETUP_CODE,
      }));`,
    );
    // Der echte Launcher und sein echter Bun-Kindprozess laden .env jeweils selbst:
    // https://bun.com/docs/runtime/environment-variables
    const child = spawnSync("bun", [fileURLToPath(new URL("./start-server.ts", import.meta.url))], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: "postgres://geerbter-owner:erfunden@localhost/haben_e2e",
        E2E_DATABASE_URL: "postgres://geerbte-fixture:erfunden@localhost/haben_e2e",
        E2E_APP_DATABASE_URL: "postgres://geerbte-app:erfunden@localhost/haben_e2e",
        HABEN_SETUP_CODE: undefined,
        E2E_SERVER_COMMAND: "bun environment-probe.ts",
      },
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      MIGRATION_DATABASE_URL: "",
      E2E_DATABASE_URL: "",
      E2E_APP_DATABASE_URL: "",
      HABEN_SETUP_CODE: "dotenv-bleibt-wirksam",
    });
  } finally {
    const cleanup = await realpath(directory);
    if (dirname(cleanup) === temporaryRoot) await rm(cleanup, { recursive: true, force: true });
  }
});
