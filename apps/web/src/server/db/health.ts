import postgres from "postgres";
import journal from "../../../drizzle/meta/_journal.json";

const latestMigration = journal.entries.at(-1)!.when;

async function readHealth(client: postgres.Sql): Promise<"ok" | "datenbank" | "migrationen"> {
  try {
    await client`select 1`;
    // Wie der Drizzle-Migrator: Nur Einträge nach dem zuletzt angewendeten Stand stehen noch aus.
    const [row] = await client<{ ready: boolean }[]>`select exists (
      select 1 from drizzle.__drizzle_migrations where created_at >= ${latestMigration}
    ) as ready`;
    return row?.ready ? "ok" : "migrationen";
  } catch (error) {
    const missingJournal = error instanceof postgres.PostgresError && (error.code === "42P01" || error.code === "3F000");
    return missingJournal ? "migrationen" : "datenbank";
  }
}

export function createHealthCheck(client: postgres.Sql) {
  let pending: ReturnType<typeof readHealth> | undefined;
  const headers = { "Cache-Control": "no-store" };

  return async (): Promise<Response> => {
    // Bei einer hängenden Verbindung belegt auch eine Folgeprobe keinen weiteren Platz im Pool.
    pending ??= new Promise((resolve) => {
      const timer = setTimeout(() => resolve("datenbank"), 2000);
      void readHealth(client).then((status) => {
        clearTimeout(timer);
        pending = undefined;
        resolve(status);
      });
    });
    const status = await pending;
    return status === "ok" ? Response.json({ status }, { headers }) : Response.json({ status: "nicht bereit", grund: status }, { status: 503, headers });
  };
}
