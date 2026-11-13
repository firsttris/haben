import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { checkApplicationConnection, grantApplicationAccess } from "./roles.ts";

const applicationUrl = process.env.DATABASE_URL;
if (!applicationUrl) throw new Error("DATABASE_URL fehlt");
const migrationUrl = process.env.MIGRATION_DATABASE_URL || applicationUrl;

// Eine Verbindung: die Sperre gilt für die Sitzung, in der auch migriert wird.
const client = postgres(migrationUrl, { max: 1 });
const application = process.env.MIGRATION_DATABASE_URL ? postgres(applicationUrl, { max: 1 }) : null;
// Zwei gleichzeitig startende Container migrieren nacheinander statt gegeneinander.
const LOCK = 0x686162656e; // "haben"
try {
  await client`select pg_advisory_lock(${LOCK})`;
  const app = application ? await checkApplicationConnection(client, application, LOCK) : null;
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)),
  });
  if (app) await grantApplicationAccess(client, app);
  await client`select pg_advisory_unlock(${LOCK})`;
} finally {
  await Promise.all([client.end(), application?.end()]);
}
console.log("Migrationen angewendet");
