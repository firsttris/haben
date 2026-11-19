import { z } from "zod";
import { networkErrorText } from "@haben/core";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";

/*
 * Lesender Client für die Transaction Search API von PayPal
 * (https://developer.paypal.com/api/transaction-search/v1/, #1512).
 *
 * Zugang ist OAuth 2.0 mit Client-ID und Secret der PayPal-App des Betreibers (Client Credentials,
 * https://developer.paypal.com/api/rest/authentication/): `POST /v1/oauth2/token` liefert ein Token mit Laufzeit, das der
 * Client bis kurz vor Ablauf wiederverwendet und nach einem 401 einmal erneuert. Live und Sandbox haben verschiedene Hosts.
 */

export const PAYPAL_HOSTS = { live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" } as const;
export type PayPalEnvironment = keyof typeof PAYPAL_HOSTS;

/** Fehler beim Zugriff auf die PayPal-API */
export class PayPalApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PayPalApiError";
    this.status = status;
    this.path = path;
  }
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  environment?: PayPalEnvironment;
  fetch?: typeof fetch;
  now?: () => number;
  /** Für Tests injizierbar; Standard setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Eine Zeile der Transaction Search, auf das reduziert, was Haben braucht. Beträge in Cent mit dem Vorzeichen der API:
 * `amount` ist der Bruttobetrag (eingehend positiv), `fee` die Gebühr, so wie PayPal sie nennt (bei einer Zahlung
 * negativ, bei einer Erstattung kann sie positiv sein, wie die Spalte „Gebühr“ des CSV-Exports).
 */
export interface PayPalTransaction {
  /** `transaction_id`; allein nicht eindeutig (siehe `eintraege.ts`) */
  id: string;
  /** T-Code, etwa `T0006`; leer, wenn PayPal keinen nennt */
  eventCode: string;
  /** `transaction_initiation_date` wie geliefert, mit Offset */
  initiated: string;
  /** `S`, `P`, `D` oder `V` */
  status: string;
  amount: number;
  currency: string;
  fee: number;
  feeCurrency: string | null;
  subject?: string;
  invoiceId?: string;
  itemTitle?: string;
  referenceId?: string;
  referenceIdType?: string;
  /** Name der Gegenseite, sonst ihre E-Mail-Adresse */
  payerName?: string;
}

const money = z.looseObject({ currency_code: z.string(), value: z.string() });
const text = z.string().nullish();

const detailSchema = z.looseObject({
  transaction_info: z.looseObject({
    transaction_id: z.string(),
    transaction_event_code: text,
    transaction_initiation_date: z.string(),
    transaction_amount: money,
    fee_amount: money.nullish(),
    transaction_status: text,
    transaction_subject: text,
    invoice_id: text,
    paypal_reference_id: text,
    paypal_reference_id_type: text,
  }),
  payer_info: z
    .looseObject({
      email_address: text,
      payer_name: z.looseObject({ given_name: text, surname: text, full_name: text, alternate_full_name: text }).nullish(),
    })
    .nullish(),
  cart_info: z.looseObject({ item_details: z.array(z.looseObject({ item_name: text })).nullish() }).nullish(),
});

const listSchema = z.looseObject({
  transaction_details: z.array(detailSchema).nullish(),
  total_pages: z.number().int().nullish(),
});
const balancesSchema = z.looseObject({ account_id: z.string().min(1) });
const tokenSchema = z.looseObject({ access_token: z.string().min(1), expires_in: z.number().positive().nullish() });

/** Betrag „-12.30“ als ganze Cent, ohne Gleitkomma; mehr als zwei Nachkommastellen mit Wert gibt es bei EUR nicht */
export function centsOf(value: string, what: string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new PayPalApiError(`Unerwarteter Betrag bei PayPal (${what})`, 0, "");
  const fraction = match[3] ?? "";
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) throw new PayPalApiError(`Betrag mit mehr als zwei Nachkommastellen bei PayPal (${what})`, 0, "");
  const cents = Number(match[2]) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || undefined;

function normalize(raw: z.infer<typeof detailSchema>): PayPalTransaction {
  const info = raw.transaction_info;
  const name = raw.payer_info?.payer_name;
  const person = [clean(name?.given_name), clean(name?.surname)].filter(Boolean).join(" ");
  const payerName = clean(name?.full_name) ?? clean(name?.alternate_full_name) ?? (person || clean(raw.payer_info?.email_address));
  const fee = info.fee_amount;
  const status = clean(info.transaction_status);
  return {
    id: info.transaction_id,
    eventCode: clean(info.transaction_event_code) ?? "",
    initiated: info.transaction_initiation_date,
    status: status ?? "",
    amount: centsOf(info.transaction_amount.value, info.transaction_id),
    currency: info.transaction_amount.currency_code.toUpperCase(),
    fee: fee ? centsOf(fee.value, info.transaction_id) : 0,
    feeCurrency: fee ? fee.currency_code.toUpperCase() : null,
    ...(clean(info.transaction_subject) ? { subject: clean(info.transaction_subject) } : {}),
    ...(clean(info.invoice_id) ? { invoiceId: clean(info.invoice_id) } : {}),
    ...(clean(raw.cart_info?.item_details?.[0]?.item_name) ? { itemTitle: clean(raw.cart_info?.item_details?.[0]?.item_name) } : {}),
    ...(clean(info.paypal_reference_id) ? { referenceId: clean(info.paypal_reference_id) } : {}),
    ...(clean(info.paypal_reference_id_type) ? { referenceIdType: clean(info.paypal_reference_id_type) } : {}),
    ...(payerName ? { payerName } : {}),
  };
}

const DAY = 86_400;
/** Die API erlaubt je Abfrage höchstens 31 Tage; 30 lässt Luft für die Grenzen */
const WINDOW_SECONDS = 30 * DAY;
const PAGE_SIZE = 500;
/** Schutz gegen eine Endlosschleife; bei 500 je Seite sind das fünf Millionen Zeilen */
const MAX_PAGES = 10_000;
/** Wiederholungen bei 429/502/503/504 und Netzwerkfehlern */
const MAX_RETRIES = 3;

const startOfDay = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const isoSeconds = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 19) + "Z";

export class PayPalClient {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(options: PayPalClientOptions) {
    if (!options.clientId.trim() || !options.clientSecret.trim()) throw new Error("Client-ID und Secret der PayPal-App fehlen");
    this.#clientId = options.clientId.trim();
    this.#clientSecret = options.clientSecret.trim();
    this.#baseUrl = PAYPAL_HOSTS[options.environment ?? "live"];
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Kennung des Händlerkontos (`account_id` des Saldos, die „Payer ID“): die Kontokennung der Quellenbindung. Der Aufruf
   * prüft zugleich die Zugangsdaten und das Recht auf Transaction Search.
   */
  async accountId(): Promise<string> {
    return (await this.#json("/v1/reporting/balances", balancesSchema)).account_id;
  }

  /**
   * Alle Zeilen, die das Guthaben ändern (`balance_affecting_records_only=Y`), für die Tage `dateFrom` bis `dateTo`, über alle Fenster
   * und Seiten. Die API schneidet nach Zeitpunkt, Haben bucht nach dem Tag in der Zeitzone des Kontos (`eintraege.ts`): Der Client holt deshalb
   * einen Tag davor und zwei danach mit, die Auswahl trifft der Aufrufer. Ein Fenster ist höchstens 30 Tage lang; das Ende
   * liegt nie nach jetzt. Eine Zeile, die auf zwei Seiten oder in zwei Fenstern steht, kommt einmal.
   */
  async transactions(dateFrom: string, dateTo: string): Promise<PayPalTransaction[]> {
    const end = Math.min(startOfDay(dateTo) + 2 * DAY, Math.floor(this.#now() / 1000));
    const all: PayPalTransaction[] = [];
    const seen = new Set<string>();
    for (let start = startOfDay(dateFrom) - DAY; start < end; start += WINDOW_SECONDS) {
      const windowEnd = Math.min(start + WINDOW_SECONDS, end);
      for (let page = 1; ; page++) {
        if (page > MAX_PAGES) throw new PayPalApiError("Zu viele Seiten beim Abruf der Transaktionen", 0, "/v1/reporting/transactions");
        const query = new URLSearchParams({
          start_date: isoSeconds(start),
          end_date: isoSeconds(windowEnd),
          fields: "all",
          balance_affecting_records_only: "Y",
          page_size: String(PAGE_SIZE),
          page: String(page),
        });
        const result = await this.#json(`/v1/reporting/transactions?${query}`, listSchema);
        const rows = result.transaction_details ?? [];
        for (const raw of rows) {
          const key = `${raw.transaction_info.transaction_id}|${raw.transaction_info.transaction_event_code ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(normalize(raw));
        }
        if (rows.length === 0 || page >= (result.total_pages ?? 1)) break;
      }
    }
    return all;
  }

  async #accessToken(): Promise<string> {
    if (this.#token && this.#now() < this.#token.expiresAt) return this.#token.value;
    const path = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64");
    const response = await this.#send(path, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: "grant_type=client_credentials",
    });
    const token = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!token.success) throw new PayPalApiError("Unerwartete Antwort von PayPal beim Anmelden", response.status, path);
    // Eine Minute Reserve, damit ein Token nicht mitten im Abruf abläuft
    this.#token = { value: token.data.access_token, expiresAt: this.#now() + ((token.data.expires_in ?? 300) - 60) * 1000 };
    return token.data.access_token;
  }

  async #json<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let response = await this.#send(
      path,
      { method: "GET", headers: { authorization: `Bearer ${await this.#accessToken()}`, accept: "application/json" } },
      true,
    );
    if (response.status === 401) {
      // Das Token kann früher ablaufen, als `expires_in` sagt, oder entzogen sein: einmal neu anmelden
      this.#token = null;
      response = await this.#send(path, { method: "GET", headers: { authorization: `Bearer ${await this.#accessToken()}`, accept: "application/json" } });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new PayPalApiError("Antwort ist kein JSON", response.status, path, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new PayPalApiError(`Unerwartete Antwort von PayPal: ${parsed.error.issues[0]?.message ?? ""}`, response.status, path);
    }
    return parsed.data;
  }

  /** Eine Anfrage mit Wiederholung; `allow401` gibt ein 401 zurück, statt zu werfen, damit der Aufrufer das Token erneuern kann */
  async #send(path: string, init: RequestInit, allow401 = false): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, init);
      } catch (cause) {
        if (attempt < MAX_RETRIES) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        throw new PayPalApiError(`PayPal nicht erreichbar: ${networkErrorText(cause)}`, 0, path, { cause });
      }
      if (response.ok || (allow401 && response.status === 401)) return response;
      const body = await response.text().catch(() => "");
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await this.#sleep(parseRetryAfter(response.headers.get("retry-after"), this.#now()) ?? backoff(attempt));
        continue;
      }
      throw new PayPalApiError(errorText(response.status, body, this.#secrets(init)), response.status, path);
    }
  }

  /** Alles, was in keiner Meldung stehen darf: Client-ID, Secret, deren Base64-Form und das aktuelle Token */
  #secrets(init: RequestInit): string[] {
    const authorization = (init.headers as Record<string, string> | undefined)?.authorization ?? "";
    return [
      this.#clientSecret,
      this.#clientId,
      Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64"),
      this.#token?.value ?? "",
      authorization.split(" ")[1] ?? "",
    ].filter((s) => s.length >= 4);
  }
}

/**
 * Fehlermeldung aus der Antwort. PayPal liefert {name, message, details: [{issue, description}]}, die Anmeldung
 * {error, error_description}. Geheimnisse werden ersetzt, bevor gekürzt wird, sonst bliebe ein Stück stehen.
 */
function errorText(status: number, body: string, secrets: string[]): string {
  const scrub = (value: string) => secrets.reduce((text, secret) => text.replaceAll(secret, "…"), value);
  let detail = scrub(body).slice(0, 300);
  try {
    const json = JSON.parse(body) as {
      name?: unknown;
      message?: unknown;
      error?: unknown;
      error_description?: unknown;
      details?: { description?: unknown; issue?: unknown }[];
    };
    const parts = [json.message ?? json.error_description, json.details?.[0]?.description ?? json.details?.[0]?.issue, json.name ?? json.error].filter(
      (p): p is string => typeof p === "string" && p !== "",
    );
    if (parts.length > 0) detail = scrub(parts.join(" ")).slice(0, 300);
  } catch {
    // kein JSON
  }
  const prefix =
    status === 401
      ? "Anmeldung abgelehnt (Client-ID oder Secret falsch, oder aus Live und Sandbox die falsche Umgebung)"
      : status === 403
        ? "Zugriff abgelehnt (die PayPal-App braucht das Recht „Transaction Search“)"
        : status === 429
          ? "Zu viele Abrufe"
          : `HTTP ${status}`;
  return detail ? `${prefix}: ${detail}` : prefix;
}
