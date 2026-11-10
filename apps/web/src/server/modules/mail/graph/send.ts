import { randomUUID } from "node:crypto";
import { MailError } from "../errors.ts";
import type { MailTransport, OutgoingMail } from "../transport.ts";
import { graphError } from "./errors.ts";
import { buildSendMailBody } from "./message.ts";

export const GRAPH_URL = "https://graph.microsoft.com/v1.0";

/** Versuche je Mail und die längste Wartezeit insgesamt; der Nutzer wartet in der Oberfläche */
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 30_000;
const TIMEOUT_MS = 30_000;

export interface GraphDeps {
  /** Zugriffstoken für Microsoft Graph (App-only); wirft eine `MailError`, wenn die Anmeldung scheitert */
  tokenProvider: () => Promise<string>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** `Retry-After` als Sekunden oder Datum, in Millisekunden; null, wenn es fehlt oder unlesbar ist */
function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Transport über `POST /users/{postfach}/sendMail` (Antwort 202). Wiederholt wird nur bei 429 und 503 mit `Retry-After`:
 * Dort hat Microsoft die Mail sicher nicht angenommen. Nach einer Zeitüberschreitung oder einem anderen 5xx wird nicht
 * wiederholt, denn ein 202 trägt keine Kennung, und eine Rechnung soll nicht doppelt ankommen.
 */
export function createGraphTransport(mailbox: string, deps: GraphDeps): MailTransport {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async sendMail(mail: OutgoingMail) {
      const body = JSON.stringify(buildSendMailBody(mail));
      const url = `${GRAPH_URL}/users/${encodeURIComponent(mailbox)}/sendMail`;
      let waited = 0;
      for (let attempt = 1; ; attempt++) {
        const token = await deps.tokenProvider();
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "client-request-id": randomUUID() },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          throw new MailError(`Keine Verbindung zu Microsoft 365: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (response.status === 202) return;
        const text = await response.text().catch(() => "");
        if ((response.status === 429 || response.status === 503) && attempt < MAX_ATTEMPTS) {
          const wait = retryAfterMs(response.headers.get("retry-after")) ?? 1000 * 2 ** (attempt - 1);
          if (waited + wait <= MAX_WAIT_MS) {
            waited += wait;
            await sleep(wait);
            continue;
          }
        }
        throw graphError(response.status, text, mailbox, response.headers.get("request-id") ?? response.headers.get("client-request-id"));
      }
    },
  };
}
