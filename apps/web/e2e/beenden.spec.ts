import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";

/*
 * Der gebaute Server muss sich auf SIGTERM selbst beenden. podman stop und docker stop warten zehn Sekunden
 * und schicken dann SIGKILL; ein Neustart (Update, systemctl restart) dauert sonst jedes Mal so lange und
 * bricht laufende Arbeit hart ab. Nitro schließt bei SIGTERM nur den HTTP-Server, offene Verbindungen zu
 * PostgreSQL halten den Prozess danach am Leben. Läuft nur gegen den gebauten Server (E2E_SERVER_COMMAND).
 */

const command = process.env.E2E_SERVER_COMMAND;
const port = Number(process.env.E2E_PORT ?? 3100) + 8;
/** Unter der Frist von podman stop (10 s); Nitro wartet bis zu 5 s auf laufende Anfragen */
const MAX_EXIT_MS = 8_000;

test.skip(!command, "nur gegen den gebauten Server (E2E_SERVER_COMMAND)");
test.setTimeout(60_000);

async function waitForServer(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server unter ${url} nicht erreichbar`);
}

function exited(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

let server: ChildProcess;

test.beforeAll(async () => {
  // exec: kill() trifft den Server selbst, nicht nur die Shell
  server = spawn("sh", ["-c", `exec ${command}`], {
    stdio: "ignore",
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      PORT: String(port),
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      HABEN_SCHEDULER: "off",
      HABEN_SETUP_CODE: "e2e-einrichtungscode",
    },
  });
  await waitForServer(`http://localhost:${port}/login`);
});

test.afterAll(() => {
  server?.kill("SIGKILL");
});

test("beendet sich auf SIGTERM, auch mit offenen Verbindungen zur Datenbank", async () => {
  // Die Anmeldeseite fragt die Datenbank ab (gibt es schon ein Konto?), danach liegen Verbindungen im Pool
  const response = await fetch(`http://localhost:${port}/login`, { redirect: "manual" });
  expect(response.status).toBeLessThan(500);

  server.kill("SIGTERM");
  expect(await exited(server, MAX_EXIT_MS)).toBe(true);
});
