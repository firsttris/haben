import { z } from "zod";
import { networkErrorText } from "@haben/core";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";

/*
 * Client für die Vivid Business API v1 (nur lesend), nach der OpenAPI-Beschreibung unter
 * https://api.prime.vivid.money/sme-integration/docs/ (api.json). Alle Routen sind POST mit JSON-Körper, auch die
 * lesenden; der API-Schlüssel steht ohne „Bearer“ in `Authorization`. Felder sind immer vorhanden, fehlende Werte `null`;
 * Listen mit festen Werten können wachsen, deshalb liest der Client sie als Text.
 */

export const VIVID_DEFAULT_BASE_URL = "https://api.prime.vivid.money/sme-integration";

/** Fehler beim Zugriff auf die Vivid-API; `code` aus der Fehlerantwort ({trace_id, errors: [{code, message}]}) */
export class VividApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly code: string | null;
  readonly path: string;
  constructor(message: string, status: number, code: string | null, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VividApiError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

/** Schlüssel ungültig, widerrufen, abgelaufen oder ohne Recht: ein neuer Abruf ändert daran nichts */
export function vividZugangAbgelehnt(error: unknown): boolean {
  return error instanceof VividApiError && (error.status === 401 || error.status === 403);
}

export interface VividClientOptions {
  /** API-Schlüssel aus Vivid Business (API › Add API token), etwa `vivid_sk_v1_…` */
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Für Tests injizierbar; Standard setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

const accountSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  currency: z.string().nullish(),
  state: z.string().nullish(),
  account_details: z.array(z.looseObject({ iban: z.string().nullish(), bic: z.string().nullish(), type: z.string().nullish() })).nullish(),
});
export type VividAccount = z.infer<typeof accountSchema>;

const transactionSchema = z.looseObject({
  /** Stabil über die ganze Lebensdauer; aus der Vormerkung wird die Buchung mit derselben id */
  id: z.string(),
  account_id: z.string(),
  type: z.string().nullish(),
  state: z.string().nullish(),
  amount: z.string(),
  currency: z.string(),
  original_amount: z.string().nullish(),
  original_currency: z.string().nullish(),
  show_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  merchant: z.looseObject({ name: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish() }).nullish(),
  card: z.looseObject({ last_4: z.string().nullish() }).nullish(),
});
export type VividTransaction = z.infer<typeof transactionSchema>;

const transactionsPageSchema = z.looseObject({
  transactions: z.array(transactionSchema).default([]),
  next_cursor: z.string().nullish(),
});

/** Größte Seite laut API */
const PAGE_SIZE = 500;
/** Schutz gegen eine Endlosschleife, falls die API immer einen Cursor liefert */
const MAX_PAGES = 200;
/** Wiederholungen bei 429, 502, 503, 504 und Netzwerkfehlern; alle Routen lesen nur */
const MAX_RETRIES = 3;

export interface VividClient {
  /** Prüft den Schlüssel */
  ping(): Promise<void>;
  /** Offene Zahlungskonten, die der Ersteller des Schlüssels sieht */
  accounts(): Promise<VividAccount[]>;
  /** Alle Umsätze eines Kontos aus den letzten 90 Tagen, über alle Seiten */
  transactions(accountId: string): Promise<VividTransaction[]>;
}

export function vividClient(options: VividClientOptions): VividClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("API-Schlüssel fehlt");
  const baseUrl = (options.baseUrl ?? VIVID_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function request(path: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { authorization: apiKey, accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new VividApiError(`Vivid nicht erreichbar: ${networkErrorText(cause)}`, 0, null, path, { cause });
      }
      if (response.ok) return response;
      const text = await response.text().catch(() => "");
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(parseRetryAfter(response.headers.get("retry-after"), now()) ?? backoff(attempt));
        continue;
      }
      const { code, message } = errorText(response.status, text);
      throw new VividApiError(message, response.status, code, path);
    }
  }

  async function json<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    const response = await request(path, body);
    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      throw new VividApiError("Antwort ist kein JSON", response.status, null, path, { cause });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new VividApiError(`Unerwartete Antwort von Vivid: ${parsed.error.issues[0]?.message ?? ""}`, response.status, null, path);
    return parsed.data;
  }

  return {
    async ping() {
      await json("/api/v1/ping", z.looseObject({}), {});
    },
    async accounts() {
      return (await json("/api/v1/accounts/current/list", z.looseObject({ accounts: z.array(accountSchema).default([]) }), {})).accounts;
    },
    async transactions(accountId) {
      const all: VividTransaction[] = [];
      let cursor: string | null | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        // Den Cursor unverändert und mit denselben Filtern zurückschicken (API: Pagination)
        const body = { account_ids: [accountId], limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
        const result = await json("/api/v1/transactions/list", transactionsPageSchema, body);
        all.push(...result.transactions);
        cursor = result.next_cursor;
        // Erst ein fehlender Cursor ist das Ende, nicht eine kurze oder leere Seite
        if (!cursor) return all;
      }
      throw new VividApiError("Zu viele Seiten beim Abruf der Umsätze", 0, null, "/api/v1/transactions/list");
    },
  };
}

/** Bekannte Fehlercodes in Klartext (API: Errors); unbekannte als Fehler ihres Status */
const CODES: Record<string, string> = {
  invalid_key: "Der API-Schlüssel ist ungültig.",
  key_revoked: "Der API-Schlüssel wurde in Vivid gelöscht. Bitte einen neuen anlegen.",
  key_expired: "Der API-Schlüssel ist abgelaufen. Bitte in Vivid einen neuen anlegen.",
  address_not_allowed: "Der API-Schlüssel ist auf andere IP-Adressen beschränkt.",
  scope_denied: "Dem API-Schlüssel fehlt ein Recht (accounts:read und transactions:read).",
  user_not_in_entity: "Wer den API-Schlüssel angelegt hat, gehört nicht mehr zur Firma. Bitte einen neuen anlegen.",
  issuer_not_permitted: "Wer den API-Schlüssel angelegt hat, darf keine API-Schlüssel mehr verwalten. Bitte einen neuen anlegen.",
  entity_inactive: "Vivid hat den API-Zugang der Firma gesperrt.",
  rate_limited: "Zu viele Abrufe bei Vivid.",
};

/** Behandelt wird nach Status und `code`, nie nach `message` (API: Errors); die Meldung von Vivid steht nur dabei */
function errorText(status: number, body: string): { code: string | null; message: string } {
  let code: string | null = null;
  try {
    const json = JSON.parse(body) as { errors?: { code?: unknown }[] };
    const first = json.errors?.[0]?.code;
    if (typeof first === "string") code = first;
  } catch {
    // kein JSON
  }
  const known = code ? CODES[code] : undefined;
  if (known) return { code, message: known };
  return { code, message: `HTTP ${status}${code ? ` (${code})` : ""}` };
}
