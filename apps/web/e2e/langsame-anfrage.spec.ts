import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { createConnection, createServer, type Server, type Socket } from "node:net";

/*
 * Der gebaute Server darf eine Anfrage nicht abbrechen, nur weil die Antwort länger als zehn Sekunden braucht
 * (ERiC-Übermittlung, Belegerkennung, eine langsame Datenbank). Bun.serve trennt die Verbindung nach
 * `idleTimeout` (Standard 10 s), wenn niemand ihn setzt. Läuft nur gegen den gebauten Server
 * (E2E_SERVER_COMMAND, wie in der CI): Dafür startet der Test ihn ein zweites Mal, mit einer Datenbank-
 * Verbindung, die jede Antwort von PostgreSQL um zwölf Sekunden verzögert.
 */

const command = process.env.E2E_SERVER_COMMAND;
const databaseUrl = new URL(process.env.E2E_DATABASE_URL ?? "postgres://localhost/haben_e2e");
const port = Number(process.env.E2E_PORT ?? 3100) + 7;
const DELAY_MS = 12_000;

test.skip(!command, "nur gegen den gebauten Server (E2E_SERVER_COMMAND)");
test.setTimeout(90_000);

/** TCP-Weiterleitung zu PostgreSQL; solange `slow()` true ist, kommt jede Antwort erst nach DELAY_MS an. */
function delayingProxy(slow: () => boolean): Promise<Server> {
  const server = createServer((client) => {
    const db = createConnection({ host: databaseUrl.hostname, port: Number(databaseUrl.port || 5432) });
    sockets.push(client, db);
    client.on("data", (chunk) => db.write(chunk));
    db.on("data", (chunk) => (slow() ? setTimeout(() => client.write(chunk), DELAY_MS) : client.write(chunk)));
    client.on("error", () => db.destroy());
    db.on("error", () => client.destroy());
    client.on("close", () => db.end());
    db.on("close", () => client.end());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

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

const sockets: Socket[] = [];
let proxy: Server;
let server: ChildProcess;
let slow = false;

test.beforeAll(async () => {
  proxy = await delayingProxy(() => slow);
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Proxy ohne Port");
  const viaProxy = new URL(databaseUrl);
  viaProxy.hostname = "127.0.0.1";
  viaProxy.port = String(address.port);
  // exec: kill() trifft den Server selbst, nicht nur die Shell
  server = spawn("sh", ["-c", `exec ${command}`], {
    stdio: "ignore",
    env: {
      ...process.env,
      DATABASE_URL: viaProxy.toString(),
      PORT: String(port),
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      HABEN_SCHEDULER: "off",
      HABEN_SETUP_CODE: "e2e-einrichtungscode",
    },
  });
  await waitForServer(`http://localhost:${port}/api/auth/get-session`);
});

test.afterAll(async () => {
  server?.kill();
  for (const socket of sockets) socket.destroy();
  await new Promise((r) => proxy?.close(r));
});

test("eine Antwort, die länger als zehn Sekunden braucht, kommt trotzdem an", async () => {
  slow = true;
  const start = Date.now();
  const response = await fetch(`http://localhost:${port}/login`, { redirect: "manual" });
  slow = false;
  expect(Date.now() - start).toBeGreaterThanOrEqual(DELAY_MS);
  expect(response.status).toBeLessThan(500);
});
