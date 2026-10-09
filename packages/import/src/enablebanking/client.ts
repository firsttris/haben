import { createSign } from "node:crypto";
import { z } from "zod";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";

export const ENABLE_BANKING_DEFAULT_BASE_URL = "https://api.enablebanking.com";

/** Fehler beim Zugriff auf die Enable-Banking-API */
export class EnableBankingApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EnableBankingApiError";
    this.status = status;
    this.path = path;
  }
}

export interface EnableBankingClientOptions {
  /** Application ID aus dem Enable-Banking-Kontrollzentrum; zugleich `kid` des JWT */
  applicationId: string;
  /** Privater RSA-Schlüssel der Anwendung (PEM) */
  privateKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Für Tests injizierbar; Standard setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

const aspspSchema = z.looseObject({
  name: z.string(),
  country: z.string(),
  logo: z.string().optional(),
  bic: z.string().optional(),
  maximum_consent_validity: z.number().optional(),
  psu_types: z.array(z.string()).optional(),
  beta: z.boolean().optional(),
});
export type Aspsp = z.infer<typeof aspspSchema>;

const authSchema = z.looseObject({ url: z.string(), authorization_id: z.string().optional() });

const accountSchema = z.looseObject({
  uid: z.string(),
  account_id: z.looseObject({ iban: z.string().nullish() }).nullish(),
  name: z.string().nullish(),
  details: z.string().nullish(),
  product: z.string().nullish(),
  currency: z.string().nullish(),
});
export type EbAccount = z.infer<typeof accountSchema>;

const sessionSchema = z.looseObject({
  session_id: z.string(),
  accounts: z.array(accountSchema).default([]),
  aspsp: z.looseObject({ name: z.string(), country: z.string() }).optional(),
  access: z.looseObject({ valid_until: z.string() }).optional(),
});
export type EbSession = z.infer<typeof sessionSchema>;

const sessionStatusSchema = z.looseObject({
  status: z.string().optional(),
  access: z.looseObject({ valid_until: z.string() }).optional(),
});

const partySchema = z.looseObject({ name: z.string().nullish() }).nullish();
const partyAccountSchema = z.looseObject({ iban: z.string().nullish() }).nullish();

const transactionSchema = z.looseObject({
  entry_reference: z.string().nullish(),
  transaction_id: z.string().nullish(),
  transaction_amount: z.looseObject({ currency: z.string(), amount: z.string() }),
  credit_debit_indicator: z.enum(["CRDT", "DBIT"]),
  status: z.string().nullish(),
  booking_date: z.string().nullish(),
  value_date: z.string().nullish(),
  transaction_date: z.string().nullish(),
  creditor: partySchema,
  creditor_account: partyAccountSchema,
  debtor: partySchema,
  debtor_account: partyAccountSchema,
  remittance_information: z.array(z.string()).nullish(),
  bank_transaction_code: z.looseObject({ description: z.string().nullish(), code: z.string().nullish() }).nullish(),
  note: z.string().nullish(),
});
export type EbTransaction = z.infer<typeof transactionSchema>;

const transactionsPageSchema = z.looseObject({
  transactions: z.array(transactionSchema).default([]),
  continuation_key: z.string().nullish(),
});

const balanceSchema = z.looseObject({
  name: z.string().nullish(),
  balance_amount: z.looseObject({ currency: z.string(), amount: z.string() }),
  balance_type: z.string().nullish(),
  reference_date: z.string().nullish(),
});
export type EbBalance = z.infer<typeof balanceSchema>;

/** Schutz gegen eine Endlosschleife, falls die Bank immer einen continuation_key liefert */
const MAX_PAGES = 500;
/** Wiederholungen lesender Abrufe bei 429/502/503/504 und Netzwerkfehlern */
const MAX_RETRIES = 3;

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/**
 * Client für die Enable-Banking-API (PSD2-Kontozugriff). Jeder Request trägt ein mit dem
 * Anwendungsschlüssel signiertes JWT (RS256), das eine Stunde gilt und wiederverwendet wird.
 */
export class EnableBankingClient {
  readonly #applicationId: string;
  readonly #privateKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  #token: { value: string; expires: number } | null = null;

  constructor(options: EnableBankingClientOptions) {
    if (!options.applicationId.trim()) throw new Error("Application ID fehlt");
    if (!options.privateKey.includes("PRIVATE KEY")) throw new Error("Privater Schlüssel (PEM) fehlt");
    this.#applicationId = options.applicationId.trim();
    this.#privateKey = options.privateKey;
    this.#baseUrl = (options.baseUrl ?? ENABLE_BANKING_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** JWT für die Authentifizierung gegenüber Enable Banking */
  token(): string {
    const now = Math.floor(this.#now() / 1000);
    if (this.#token && this.#token.expires - 60 > now) return this.#token.value;
    const header = base64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: this.#applicationId }));
    const expires = now + 3600;
    const payload = base64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: expires }));
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.#privateKey);
    this.#token = { value: `${header}.${payload}.${base64url(signature)}`, expires };
    return this.#token.value;
  }

  /** Banken eines Landes */
  async aspsps(country: string): Promise<Aspsp[]> {
    const result = await this.#json("GET", `/aspsps?country=${encodeURIComponent(country)}`, z.looseObject({ aspsps: z.array(aspspSchema) }));
    return result.aspsps;
  }

  /** Startet die Zustimmung bei der Bank; liefert die Adresse, zu der der Nutzer weitergeleitet wird. */
  async startAuthorization(input: {
    aspsp: { name: string; country: string };
    validUntil: Date;
    redirectUrl: string;
    state: string;
    psuType: "personal" | "business";
  }): Promise<{ url: string }> {
    return this.#json("POST", "/auth", authSchema, {
      access: { valid_until: input.validUntil.toISOString() },
      aspsp: input.aspsp,
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: input.psuType,
    });
  }

  /** Tauscht den Code aus der Rückleitung gegen eine Sitzung mit den freigegebenen Konten. */
  async createSession(code: string): Promise<EbSession> {
    return this.#json("POST", "/sessions", sessionSchema, { code });
  }

  async session(sessionId: string): Promise<z.infer<typeof sessionStatusSchema>> {
    return this.#json("GET", `/sessions/${encodeURIComponent(sessionId)}`, sessionStatusSchema);
  }

  /** Widerruft die Sitzung; eine schon abgelaufene Sitzung ist kein Fehler. */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.#request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
    } catch (error) {
      if (error instanceof EnableBankingApiError && (error.status === 404 || error.status === 401)) return;
      throw error;
    }
  }

  /** Alle Umsätze im Zeitraum (YYYY-MM-DD), über alle Seiten */
  async transactions(accountUid: string, dateFrom: string, dateTo?: string): Promise<EbTransaction[]> {
    const all: EbTransaction[] = [];
    let continuationKey: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ date_from: dateFrom });
      if (dateTo) query.set("date_to", dateTo);
      if (continuationKey) query.set("continuation_key", continuationKey);
      const result = await this.#json("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`, transactionsPageSchema);
      all.push(...result.transactions);
      continuationKey = result.continuation_key;
      if (!continuationKey) return all;
    }
    throw new EnableBankingApiError("Zu viele Seiten beim Abruf der Umsätze", 0, `/accounts/${accountUid}/transactions`);
  }

  async balances(accountUid: string): Promise<EbBalance[]> {
    const result = await this.#json("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`, z.looseObject({ balances: z.array(balanceSchema).default([]) }));
    return result.balances;
  }

  async #json<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const response = await this.#request(method, path, body);
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new EnableBankingApiError("Antwort ist kein JSON", response.status, path, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new EnableBankingApiError(`Unerwartete Antwort von Enable Banking: ${parsed.error.issues[0]?.message ?? ""}`, response.status, path);
    }
    return parsed.data;
  }

  async #request(method: string, path: string, body?: unknown): Promise<Response> {
    // Nur lesende Abrufe wiederholen; POST (Code gegen Sitzung tauschen) ist nicht idempotent
    const retries = method === "GET" ? MAX_RETRIES : 0;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.token()}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        if (attempt < retries) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        throw new EnableBankingApiError(`Enable Banking nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`, 0, path, { cause });
      }
      if (response.ok) return response;
      const text = await response.text().catch(() => "");
      if (RETRY_STATUSES.has(response.status) && attempt < retries) {
        await this.#sleep(parseRetryAfter(response.headers.get("retry-after"), this.#now()) ?? backoff(attempt));
        continue;
      }
      throw new EnableBankingApiError(errorText(response.status, text), response.status, path);
    }
  }
}

/** Fehlermeldung aus der Antwort: Enable Banking liefert {message, detail} oder {error, message} */
function errorText(status: number, body: string): string {
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body) as { message?: unknown; detail?: unknown; error?: unknown };
    const parts = [json.message, typeof json.detail === "string" ? json.detail : undefined].filter((p): p is string => typeof p === "string" && p !== "");
    if (parts.length > 0) detail = parts.join(": ");
    else if (typeof json.error === "string") detail = json.error;
  } catch {
    // kein JSON
  }
  const prefix = status === 401 || status === 403 ? "Zugriff abgelehnt" : status === 429 ? "Zu viele Abrufe" : `HTTP ${status}`;
  return detail ? `${prefix}: ${detail}` : prefix;
}
