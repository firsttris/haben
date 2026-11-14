import postgres from "postgres";
import journal from "../../../drizzle/meta/_journal.json";

const latestMigration = journal.entries.at(-1)!.when;

async function readHealth(client: postgres.Sql, signal: AbortSignal): Promise<"pass" | "database" | "migrations"> {
  try {
    await client`select 1`.signal(signal);
    // Wie der Drizzle-Migrator: Nur Einträge nach dem zuletzt angewendeten Stand stehen noch aus.
    const [row] = await client<{ ready: boolean }[]>`select exists (
      select 1 from drizzle.__drizzle_migrations where created_at >= ${latestMigration}
    ) as ready`.signal(signal);
    return row?.ready ? "pass" : "migrations";
  } catch (error) {
    const missingJournal = error instanceof postgres.PostgresError && (error.code === "42P01" || error.code === "3F000");
    return missingJournal ? "migrations" : "database";
  }
}

/**
 * Öffentliche Probe für Monitore, darum englisch und ohne Version. `status` nach draft-inadarei-api-health-check
 * (pass, fail; warn mit 200 bleibt frei für später), `reason` mit festen Werten. Monitore verlassen sich auf die Werte.
 */
export function createHealthCheck(client: postgres.Sql) {
  let pending: ReturnType<typeof readHealth> | undefined;
  const headers = { "Cache-Control": "no-store" };

  return async (): Promise<Response> => {
    // Bei einer hängenden Verbindung belegt auch eine Folgeprobe keinen weiteren Platz im Pool.
    pending ??= new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        resolve("database");
        controller.abort();
      }, 2000);
      void readHealth(client, controller.signal).then((status) => {
        clearTimeout(timer);
        pending = undefined;
        resolve(status);
      });
    });
    const status = await pending;
    return status === "pass" ? Response.json({ status }, { headers }) : Response.json({ status: "fail", reason: status }, { status: 503, headers });
  };
}
