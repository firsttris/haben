import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";
import { readDatabaseAccess } from "./roles.ts";

/**
 * Prozessweit statt je Modul: im Build bringen Nitro-Plugins und SSR-Bundle je eine eigene Kopie dieser Datei mit,
 * jede mit eigenem Pool. closeDatabase() muss alle schließen.
 */
const CLIENTS = Symbol.for("haben.dbClients");
const registry = globalThis as { [CLIENTS]?: Set<postgres.Sql> };

const clients = registry[CLIENTS] ?? new Set();
registry[CLIENTS] = clients;

const client = postgres(env().DATABASE_URL, { max: 10 });
clients.add(client);

export const db = drizzle(client, { schema });

export const databaseAccessInfo = () => readDatabaseAccess(client);
export type { DatabaseAccessInfo } from "./roles.ts";

/**
 * Schließt die Verbindungen zu PostgreSQL, damit der Prozess sich beenden kann. Laufende Abfragen dürfen noch
 * `timeoutSeconds` lang fertig werden.
 */
export async function closeDatabase(timeoutSeconds = 5): Promise<void> {
  const open = [...clients];
  clients.clear();
  await Promise.all(open.map((c) => c.end({ timeout: timeoutSeconds })));
}

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
