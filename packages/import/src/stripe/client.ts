import { z } from "zod";
import { networkErrorText } from "@haben/core";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";

export const STRIPE_DEFAULT_BASE_URL = "https://api.stripe.com";

/** Fehler beim Zugriff auf die Stripe-API */
export class StripeApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StripeApiError";
    this.status = status;
    this.path = path;
  }
}

export interface StripeClientOptions {
  /** Eingeschränkter API-Schlüssel (`rk_…`) mit Lesezugriff auf Balance und Konto; ein geheimer Schlüssel (`sk_…`) geht auch */
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Für Tests injizierbar; Standard setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

const balanceTransactionSchema = z.looseObject({
  id: z.string(),
  /** Bruttobetrag in der kleinsten Einheit, mit Vorzeichen */
  amount: z.number().int(),
  /** Unix-Sekunden */
  created: z.number().int(),
  /** Kleingeschrieben, etwa „eur“ */
  currency: z.string(),
  description: z.string().nullish(),
  /** Einbehaltene Gebühr, positiv */
  fee: z.number().int(),
  net: z.number().int(),
  reporting_category: z.string().nullish(),
  /**
   * Zugehöriges Objekt (`ch_`, `re_`, `po_` …). Der Abruf klappt `source.charge` auf (`expand`); dann ist es das
   * Objekt, bei Erstattung und Streit mit der Zahlung, auf die es sich bezieht.
   */
  source: z
    .union([
      z.string(),
      z.looseObject({
        id: z.string(),
        charge: z.union([z.string(), z.looseObject({ balance_transaction: z.union([z.string(), z.looseObject({ id: z.string() })]).nullish() })]).nullish(),
      }),
    ])
    .nullish(),
  status: z.string().nullish(),
  type: z.string(),
});

/**
 * Balance Transaction mit `source` als ID und, bei Erstattung und Streit, der Balance Transaction der ursprünglichen
 * Zahlung (`relatedTransactionId`), sofern Stripe sie nennt.
 */
export interface StripeBalanceTransaction {
  id: string;
  /** Bruttobetrag in der kleinsten Einheit, mit Vorzeichen */
  amount: number;
  /** Unix-Sekunden */
  created: number;
  /** Kleingeschrieben, etwa „eur“ */
  currency: string;
  description?: string | null;
  /** Einbehaltene Gebühr, positiv */
  fee: number;
  net: number;
  reporting_category?: string | null;
  source?: string | null;
  status?: string | null;
  type: string;
  relatedTransactionId?: string;
}

function normalize(raw: z.infer<typeof balanceTransactionSchema>): StripeBalanceTransaction {
  const { source, ...rest } = raw;
  if (!source || typeof source === "string") return { ...rest, source: source ?? null };
  const bt = typeof source.charge === "object" && source.charge ? source.charge.balance_transaction : null;
  const related = typeof bt === "string" ? bt : bt?.id;
  return { ...rest, source: source.id, ...(related ? { relatedTransactionId: related } : {}) };
}

const listSchema = z.looseObject({ data: z.array(balanceTransactionSchema), has_more: z.boolean() });
const accountSchema = z.looseObject({ id: z.string() });

/** Schutz gegen eine Endlosschleife; bei 100 je Seite sind das eine Million Bewegungen */
const MAX_PAGES = 10_000;
const PAGE_SIZE = 100;
/** Wiederholungen lesender Abrufe bei 429/502/503/504 und Netzwerkfehlern */
const MAX_RETRIES = 3;

const startOfDay = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

/** Lesender Client für die Balance Transactions von Stripe (https://docs.stripe.com/api/balance_transactions/list). */
export class StripeClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: StripeClientOptions) {
    if (!options.apiKey.trim()) throw new Error("Stripe-API-Schlüssel fehlt");
    this.#apiKey = options.apiKey.trim();
    this.#baseUrl = (options.baseUrl ?? STRIPE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** ID des Kontos (`acct_…`), das zum Schlüssel gehört: die Kontokennung der Quellenbindung */
  async accountId(): Promise<string> {
    return (await this.#json("/v1/account", accountSchema)).id;
  }

  /** Alle Balance Transactions, deren `created` in den Tagen von `dateFrom` bis `dateTo` (UTC, einschließlich) liegt, über alle Seiten */
  async balanceTransactions(dateFrom: string, dateTo: string): Promise<StripeBalanceTransaction[]> {
    const all: StripeBalanceTransaction[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        "created[gte]": String(startOfDay(dateFrom)),
        // Erste Sekunde nach dem letzten Tag, ausgeschlossen
        "created[lt]": String(startOfDay(dateTo) + 86_400),
      });
      // Bei Erstattung und Streit nennt die Zahlung, auf die sie sich beziehen; andere Arten haben kein `charge`
      query.append("expand[]", "data.source.charge");
      if (startingAfter) query.set("starting_after", startingAfter);
      const result = await this.#json(`/v1/balance_transactions?${query}`, listSchema);
      all.push(...result.data.map(normalize));
      const last = result.data.at(-1);
      if (!result.has_more || !last) return all;
      startingAfter = last.id;
    }
    throw new StripeApiError("Zu viele Seiten beim Abruf der Balance Transactions", 0, "/v1/balance_transactions");
  }

  async #json<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.#request(path);
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new StripeApiError("Antwort ist kein JSON", response.status, path, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new StripeApiError(`Unerwartete Antwort von Stripe: ${parsed.error.issues[0]?.message ?? ""}`, response.status, path);
    }
    return parsed.data;
  }

  async #request(path: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method: "GET",
          headers: { authorization: `Bearer ${this.#apiKey}`, accept: "application/json" },
        });
      } catch (cause) {
        if (attempt < MAX_RETRIES) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        throw new StripeApiError(`Stripe nicht erreichbar: ${networkErrorText(cause)}`, 0, path, { cause });
      }
      if (response.ok) return response;
      const text = await response.text().catch(() => "");
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await this.#sleep(parseRetryAfter(response.headers.get("retry-after"), this.#now()) ?? backoff(attempt));
        continue;
      }
      throw new StripeApiError(errorText(response.status, text), response.status, path);
    }
  }
}

/** Fehlermeldung aus der Antwort: Stripe liefert {error: {message, type, code}} */
function errorText(status: number, body: string): string {
  let detail = body.slice(0, 300);
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) detail = message;
  } catch {
    // kein JSON
  }
  const prefix = status === 401 || status === 403 ? "Zugriff abgelehnt" : status === 429 ? "Zu viele Abrufe" : `HTTP ${status}`;
  return detail ? `${prefix}: ${detail}` : prefix;
}
