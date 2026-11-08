import { FakeElsterClient } from "./fake-client.ts";
import { EricProcessClient } from "./process-client.ts";
import type { ElsterClient } from "./types.ts";

export interface ElsterEnv {
  ERIC_HOME?: string;
  ERIC_LOG_DIR?: string;
  /** Pfad zu worker.ts, falls das Paket gebündelt wurde und import.meta.url nicht mehr passt */
  ERIC_WORKER_PATH?: string;
  /** Befehl für den Worker statt der eigenen Laufzeit, durch Leerzeichen getrennt; siehe parseWorkerCommand */
  ERIC_WORKER_COMMAND?: string;
}

/**
 * ERIC_WORKER_COMMAND in Programm und Argumente zerlegen, getrennt an Leerzeichen (ohne Anführungszeichen; wer
 * mehr braucht, schreibt ein Skript). Leer oder nur Leerzeichen: keiner, der Worker läuft mit der eigenen Laufzeit.
 */
export function parseWorkerCommand(value: string | undefined): string[] | undefined {
  const words = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  return words.length > 0 ? words : undefined;
}

/** Echter ERiC-Client, wenn ERIC_HOME gesetzt ist, sonst der Fake. */
export function createElsterClient(env: ElsterEnv): ElsterClient {
  const ericHome = env.ERIC_HOME?.trim();
  if (!ericHome) return new FakeElsterClient();
  const logDir = env.ERIC_LOG_DIR?.trim();
  const workerPath = env.ERIC_WORKER_PATH?.trim();
  const workerCommand = parseWorkerCommand(env.ERIC_WORKER_COMMAND);
  return new EricProcessClient({
    ericHome,
    ...(logDir ? { logDir } : {}),
    ...(workerPath ? { workerPath } : {}),
    ...(workerCommand ? { workerCommand } : {}),
  });
}
