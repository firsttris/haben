import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Nachgebautes Dokumentenarchiv für die Tests: nimmt multipart/form-data an, merkt sich Kopfzeilen, Felder und Dateien
 * und antwortet, wie der Test es vorgibt. So prüfen die Tests das Senden über echtes HTTP, ohne Archiv im Netz.
 */

export interface Empfangen {
  headers: IncomingMessage["headers"];
  fields: Record<string, string>;
  files: Record<string, { name: string; type: string; bytes: Uint8Array }>;
}

export type Antwort = { status: number; body?: unknown; headers?: Record<string, string> };

export interface Empfaenger {
  url: string;
  received: Empfangen[];
  /** Antworten der Reihe nach; ist die Liste leer, gilt `standard` */
  queue: Antwort[];
  standard: Antwort;
  close(): Promise<void>;
}

async function lesen(request: IncomingMessage, url: string): Promise<Empfangen> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const form = await new Request(url, {
    method: "POST",
    headers: { "content-type": request.headers["content-type"] ?? "" },
    body: Buffer.concat(chunks),
  }).formData();
  const fields: Empfangen["fields"] = {};
  const files: Empfangen["files"] = {};
  for (const [name, value] of form) {
    if (typeof value === "string") fields[name] = value;
    else files[name] = { name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) };
  }
  return { headers: request.headers, fields, files };
}

export async function empfaengerStarten(standard: Antwort): Promise<Empfaenger> {
  const state = { received: [] as Empfangen[], queue: [] as Antwort[], standard };
  const server: Server = createServer((request, response) => {
    void (async () => {
      state.received.push(await lesen(request, `http://localhost${request.url}`));
      const answer = state.queue.shift() ?? state.standard;
      const text = answer.body === undefined ? "" : JSON.stringify(answer.body);
      response.writeHead(answer.status, { "content-type": "application/json", ...answer.headers });
      response.end(text);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/upload`,
    get received() {
      return state.received;
    },
    get queue() {
      return state.queue;
    },
    get standard() {
      return state.standard;
    },
    set standard(next: Antwort) {
      state.standard = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
