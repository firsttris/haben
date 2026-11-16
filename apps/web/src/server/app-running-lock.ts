import postgres from "postgres";
import { APP_RUNNING_LOCK } from "./db/app-lock.ts";
import { env } from "./env.ts";

/** Hält den geteilten Sitzungslock auch nach einem Verbindungsabbruch bis zum Herunterfahren. */
export async function holdAppRunningLock(): Promise<() => Promise<void>> {
  let stopped = false;
  let started = false;
  let reserved: Awaited<ReturnType<postgres.Sql["reserve"]>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recovering: Promise<void> | undefined;
  const client = postgres(env().DATABASE_URL, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 2,
    backoff: 1,
    onclose() {
      if (!started || stopped) return;
      reserved?.release();
      reserved = undefined;
      console.warn("Verbindung der App-Sperre unterbrochen. Die Sperre wird erneut angefordert.");
      retry();
    },
  });

  async function acquire() {
    const connection = await client.reserve();
    try {
      if (stopped) return;
      // Sitzungslocks enden mit der Verbindung; eine neue Reservierung stellt sie nicht selbst wieder her.
      // https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS
      await connection`select pg_advisory_lock_shared(${APP_RUNNING_LOCK})`;
      if (!stopped) reserved = connection;
    } finally {
      if (reserved !== connection) connection.release();
    }
  }

  function retry() {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || recovering) return;
      recovering = acquire()
        .catch(() => {
          if (!stopped) console.warn("App-Sperre noch nicht erreichbar. Ein weiterer Versuch folgt.");
        })
        .finally(() => {
          recovering = undefined;
          if (!stopped && !reserved) retry();
        });
    }, 1_000);
  }

  // Der erste Erwerb bleibt Teil der Startprüfung; nur ein späterer Verlust wird im Hintergrund behoben.
  try {
    await acquire();
    started = true;
  } catch (error) {
    stopped = true;
    await client.end({ timeout: 5 });
    throw error;
  }
  return async () => {
    stopped = true;
    clearTimeout(timer);
    reserved?.release();
    reserved = undefined;
    await client.end({ timeout: 5 });
    await recovering;
  };
}
