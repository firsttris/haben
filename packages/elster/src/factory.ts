import { FakeElsterClient } from "./fake-client.ts";
import { EricProcessClient } from "./process-client.ts";
import type { ElsterClient } from "./types.ts";

export interface ElsterEnv {
  ERIC_HOME?: string;
  ERIC_LOG_DIR?: string;
  /** Pfad zu worker.ts, falls das Paket gebündelt wurde und import.meta.url nicht mehr passt */
  ERIC_WORKER_PATH?: string;
}

/** Echter ERiC-Client, wenn ERIC_HOME gesetzt ist, sonst der Fake. */
export function createElsterClient(env: ElsterEnv): ElsterClient {
  const ericHome = env.ERIC_HOME?.trim();
  if (!ericHome) return new FakeElsterClient();
  const logDir = env.ERIC_LOG_DIR?.trim();
  const workerPath = env.ERIC_WORKER_PATH?.trim();
  return new EricProcessClient({
    ericHome,
    ...(logDir ? { logDir } : {}),
    ...(workerPath ? { workerPath } : {}),
  });
}
