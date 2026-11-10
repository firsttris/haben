import { createSign } from "node:crypto";
import { networkErrorText } from "@haben/core";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";

/*
 * Gemeinsames für die Abrufe der Finanzberichte aus Google Play und App Store Connect: signierte JWT, Fehler mit
 * HTTP-Status und Wiederholung lesender Abrufe bei Rate-Limit und Gateway-Fehlern (wie bei Enable Banking).
 */

/** Fehler beim Zugriff auf die API eines App-Stores */
export class StoreApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreApiError";
    this.status = status;
    this.path = path;
  }
}

/** Für Tests injizierbar: Netzwerk, Uhr und Warten */
export interface StoreRuntime {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolvedRuntime {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function resolveRuntime(runtime: StoreRuntime): ResolvedRuntime {
  return {
    fetch: runtime.fetch ?? globalThis.fetch.bind(globalThis),
    now: runtime.now ?? Date.now,
    sleep: runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/**
 * Signiertes JWT. RS256 für Google-Servicekonten; ES256 für App Store Connect, dort als rohe Signatur r‖s (IEEE P1363)
 * nach RFC 7518 Abschnitt 3.4, nicht als DER, das Node sonst liefert.
 */
export function signJwt(alg: "RS256" | "ES256", header: Record<string, string>, payload: Record<string, unknown>, privateKey: string): string {
  const input = `${base64url(JSON.stringify({ ...header, alg, typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature =
    alg === "RS256"
      ? createSign("RSA-SHA256").update(input).sign(privateKey)
      : createSign("SHA256").update(input).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${base64url(signature)}`;
}

/** Wiederholungen lesender Abrufe bei 429/502/503/504 und Netzwerkfehlern */
const MAX_RETRIES = 3;

/**
 * Ein Request mit Wiederholung, wenn er lesend ist (GET) oder ausdrücklich als wiederholbar markiert (Token holen).
 * Liefert die Antwort bei 2xx und bei den Status in `accept` (z. B. 404 für „kein Bericht“); sonst StoreApiError.
 */
export async function storeRequest(
  rt: ResolvedRuntime,
  label: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; retry?: boolean; accept?: number[] },
  describe: (status: number, body: string) => string,
): Promise<Response> {
  const method = init.method ?? "GET";
  const retries = method === "GET" || init.retry ? MAX_RETRIES : 0;
  const path = new URL(url).pathname;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await rt.fetch(url, { method, headers: init.headers, body: init.body });
    } catch (cause) {
      if (attempt < retries) {
        await rt.sleep(backoff(attempt));
        continue;
      }
      throw new StoreApiError(`${label} nicht erreichbar: ${networkErrorText(cause)}`, 0, path, { cause });
    }
    if (response.ok || init.accept?.includes(response.status)) return response;
    const text = await response.text().catch(() => "");
    if (RETRY_STATUSES.has(response.status) && attempt < retries) {
      await rt.sleep(parseRetryAfter(response.headers.get("retry-after"), rt.now()) ?? backoff(attempt));
      continue;
    }
    throw new StoreApiError(describe(response.status, text), response.status, path);
  }
}

/** Präfix einer Fehlermeldung nach Status */
export function statusPrefix(status: number): string {
  return status === 401 || status === 403 ? "Zugriff abgelehnt" : status === 429 ? "Zu viele Abrufe" : `HTTP ${status}`;
}

/** Monat YYYY-MM plus n Monate */
export function addReportMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Alle Monate von `from` bis einschließlich `to` (YYYY-MM); leer, wenn from nach to liegt */
export function reportMonthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addReportMonths(month, 1)) months.push(month);
  return months;
}
