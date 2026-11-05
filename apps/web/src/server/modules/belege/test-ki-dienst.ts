import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Nur für Tests: ein OpenAI-kompatibler Dienst auf 127.0.0.1 mit einem Port, den das System vergibt. Er merkt sich jede
 * Anfrage und antwortet mit dem, was der Test vorgibt.
 */

export interface RecordedRequest {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

export type Reply = (request: RecordedRequest, index: number) => { status?: number; body: unknown } | "nie";

export interface TestService {
  baseUrl: string;
  requests: RecordedRequest[];
  reply: (next: Reply) => void;
  close: () => Promise<void>;
}

/** Antwort im Format von /v1/chat/completions mit `content` als Text der ersten Wahl */
export function completion(content: string, finishReason = "stop") {
  return { id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }] };
}

export async function startTestService(initial: Reply): Promise<TestService> {
  let reply = initial;
  const requests: RecordedRequest[] = [];
  const hanging = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded = { path: req.url ?? "", headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") };
      requests.push(recorded);
      const answer = reply(recorded, requests.length - 1);
      if (answer === "nie") {
        hanging.add(res);
        return;
      }
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    reply: (next) => {
      reply = next;
    },
    close: async () => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Ein Port, an dem sicher niemand lauscht: kurz belegen und wieder freigeben */
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
