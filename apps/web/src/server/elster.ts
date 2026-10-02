import { createElsterClient, type ElsterClient } from "@haben/elster";
import { env } from "./env.ts";

let client: ElsterClient | undefined;

export function elsterClient(): ElsterClient {
  client ??= createElsterClient(env());
  return client;
}

/** Ohne ERIC_HOME läuft alles gegen einen simulierten Client. */
export function elsterMode(): "eric" | "simuliert" {
  return env().ERIC_HOME ? "eric" : "simuliert";
}
