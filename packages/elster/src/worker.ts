/**
 * Worker-Prozess für ERiC: nimmt genau eine Anfrage per IPC entgegen,
 * führt sie aus und beendet sich. Läuft mit Nodes Type-Stripping.
 */
import { runEric } from "./eric.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

function reply(message: WorkerResponse): Promise<void> {
  return new Promise((resolve) => {
    process.send!(message, undefined, {}, () => resolve());
  });
}

process.once("message", async (message: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    response = { type: "result", result: await runEric(message.config, message.request) };
  } catch (error) {
    response = { type: "error", message: error instanceof Error ? error.message : String(error) };
  }
  await reply(response);
  process.disconnect();
  process.exit(0);
});
