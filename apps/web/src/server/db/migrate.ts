import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL fehlt");

// Eine Verbindung: die Sperre gilt für die Sitzung, in der auch migriert wird.
const client = postgres(url, { max: 1 });
// Zwei gleichzeitig startende Container migrieren nacheinander statt gegeneinander.
const LOCK = 0x686162656e; // "haben"
try {
  await client`select pg_advisory_lock(${LOCK})`;
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)),
  });
  await client`select pg_advisory_unlock(${LOCK})`;
} finally {
  await client.end();
}
console.log("Migrationen angewendet");
