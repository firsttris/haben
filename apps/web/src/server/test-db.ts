import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/** Integrationstests laufen nur mit TEST_DATABASE_URL; die Datenbank wird dabei geleert. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Setzt die Umgebung, legt das Schema frisch an und wendet alle Migrationen an. */
export async function setupTestDb(): Promise<postgres.Sql> {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl,
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
  });
  const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return sql;
}
