import { spawn } from "node:child_process";
import { serverEnvironment } from "./server-env.ts";

/** Nach Reset und Migration läuft nur der echte Server ohne Betreiberzugang in seiner Umgebung weiter. */
const command = process.env.E2E_SERVER_COMMAND ?? `bun --bun vite dev --port ${process.env.PORT}`;
const child = spawn(process.platform === "win32" ? command : `exec ${command}`, {
  shell: true,
  stdio: "inherit",
  env: serverEnvironment(process.env),
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
