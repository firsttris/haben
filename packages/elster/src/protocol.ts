import type { EricConfig, EricRawResult, EricRequest } from "./eric.ts";

/** Eltern → Worker: genau eine Anfrage pro Prozess. */
export interface WorkerRequest {
  type: "request";
  config: EricConfig;
  request: EricRequest;
}

/** Worker → Eltern */
export type WorkerResponse =
  | { type: "result"; result: EricRawResult }
  | { type: "error"; message: string };
