import { createHash } from "node:crypto";
import { networkErrorText } from "@haben/core";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "./retry.ts";
import type { EtsyLedgerEntry } from "./etsy-ledger.ts";

/*
 * Etsy Open API v3: Anmeldung, Zahlungsverlauf und Bestellbezug eines Shops.
 *
 * - Anmeldung (OAuth 2.0 mit PKCE): https://developers.etsy.com/documentation/essentials/authentication
 * - Zahlungsverlauf: GET /shops/{shop_id}/payment-account/ledger-entries (Recht `transactions_r`)
 * - Bestellbezug: GET /shops/{shop_id}/payment-account/ledger-entries/payments?ledger_entry_ids=…
 *   Verkauf und Erstattung tragen im Verlauf nur die Zahlungs- bzw. Erstattungsnummer; die Bestellnummer steht
 *   in der Zahlung (receipt_id). Die Steuerzeile des Käufers trägt sie dagegen selbst.
 *
 * Etsy verlangt in jeder Anfrage den App-Schlüssel im Kopf `x-api-key`, bei einer App mit gemeinsamem Geheimnis
 * als `keystring:shared_secret`. Das Zugangstoken gilt eine Stunde; das Erneuerungstoken bleibt gültig und kommt
 * bei jeder Erneuerung neu zurück, deshalb meldet der Client es über `onTokens` an den Aufrufer.
 */

export const ETSY_API_URL = "https://openapi.etsy.com/v3/application";
export const ETSY_AUTH_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
/** Etsy liefert den Verlauf höchstens für 31 Tage je Abfrage */
export const ETSY_MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;
/** Etsy nimmt höchstens 100 Einträge je Seite und 20 Kennungen je Zahlungsabfrage */
const PAGE_SIZE = 100;
const PAYMENT_BATCH = 20;
/** Wiederholungen lesender Abrufe bei Rate-Limit und Gateway-Fehlern (wie bei den App-Stores) */
const MAX_RETRIES = 3;

/** Fehler beim Zugriff auf die Etsy-API */
export class EtsyApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern */
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EtsyApiError";
    this.status = status;
    this.path = path;
  }
}

/** Für Tests injizierbar: Netzwerk, Uhr und Warten */
export interface EtsyRuntime {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface ResolvedRuntime {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function resolveRuntime(runtime: EtsyRuntime = {}): ResolvedRuntime {
  return {
    fetch: runtime.fetch ?? globalThis.fetch.bind(globalThis),
    now: runtime.now ?? Date.now,
    sleep: runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

/** Zugangstoken eines Shops; `expiresAt` in Sekunden seit Epoch */
export interface EtsyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface EtsyClientOptions {
  /** App-Schlüssel (keystring) und gemeinsames Geheimnis der Etsy-App */
  keystring: string;
  sharedSecret?: string;
  shopId: string;
  tokens: EtsyTokens;
  /** Neues Zugangstoken aus einer Erneuerung; der Aufrufer muss es speichern */
  onTokens?: (tokens: EtsyTokens) => Promise<void> | void;
  /** Basis-URLs für die E2E-Tests (nachgebaute API); sonst die echten */
  baseUrl?: string;
  tokenUrl?: string;
  runtime?: EtsyRuntime;
}

export interface EtsyPayment {
  receipt_id?: number;
  payment_id?: number;
  payment_adjustments?: { payment_adjustment_id?: number }[];
}

export interface EtsyShop {
  shopId: string;
  shopName: string;
}

export interface EtsyClient {
  /** Der Verlauf im Zeitraum (Epoch-Sekunden), aufsteigend nach Zeitstempel */
  ledger(from: number, to: number): Promise<EtsyLedgerEntry[]>;
  /** Zahlungs- und Erstattungsnummer → Bestellnummer, für die gegebenen Verlaufszeilen (`entry_id`) */
  ordersFor(ledgerEntryIds: string[]): Promise<Map<string, string>>;
  /**
   * Land des Käufers (ISO-Code) je Bestellnummer. Mit Zeitraum (Epoch-Sekunden) liest es die Bestellungen dieses Zeitraums
   * seitenweise und fragt nur fehlende einzeln nach; ohne Zeitraum fragt es jede einzeln.
   */
  countriesFor(receiptIds: string[], zeitraum?: { from: number; to: number }): Promise<Map<string, string>>;
  /** Shop des angemeldeten Kontos; er wird beim Verbinden einmal ermittelt */
  shop(): Promise<EtsyShop>;
  tokens(): EtsyTokens;
}

/** Kopfzeile `x-api-key`: mit gemeinsamem Geheimnis `keystring:shared_secret`, sonst nur der Schlüssel */
export function apiKeyHeader(keystring: string, sharedSecret?: string): string {
  const key = keystring.trim();
  return key.includes(":") || !sharedSecret ? key : `${key}:${sharedSecret}`;
}

/** OAuth-Anmeldung: `client_id` ist der Teil vor dem Doppelpunkt */
export function clientIdOf(keystring: string): string {
  return keystring.split(":")[0] ?? "";
}

export function createEtsyClient(options: EtsyClientOptions): EtsyClient {
  const runtime = resolveRuntime(options.runtime);
  const baseUrl = (options.baseUrl ?? ETSY_API_URL).replace(/\/$/, "");
  const tokenUrl = options.tokenUrl ?? ETSY_TOKEN_URL;
  const apiKey = apiKeyHeader(options.keystring, options.sharedSecret);
  let tokens = options.tokens;

  /** Erneuert das Zugangstoken, wenn es abgelaufen ist oder bald abläuft (60 Sekunden Vorlauf) */
  async function freshToken(): Promise<string> {
    if (tokens.expiresAt - 60 > runtime.now() / 1000) return tokens.accessToken;
    const response = await runtime.fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientIdOf(options.keystring),
        refresh_token: tokens.refreshToken,
      }),
    });
    if (!response.ok) {
      throw new EtsyApiError(
        response.status === 400 || response.status === 401
          ? "Etsy lehnt die Erneuerung ab; die Verbindung muss neu hergestellt werden."
          : `Etsy antwortet auf die Erneuerung mit ${response.status}.`,
        response.status,
        "/oauth/token",
      );
    }
    tokens = tokenFromResponse(await response.json(), tokens.refreshToken, runtime.now());
    await options.onTokens?.(tokens);
    return tokens.accessToken;
  }

  async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
    for (let versuch = 0; ; versuch++) {
      let response: Response;
      try {
        response = await runtime.fetch(url, {
          headers: { "x-api-key": apiKey, authorization: `Bearer ${await freshToken()}`, accept: "application/json" },
        });
      } catch (error) {
        if (versuch < MAX_RETRIES) {
          await runtime.sleep(backoff(versuch));
          continue;
        }
        throw new EtsyApiError(`Etsy nicht erreichbar: ${networkErrorText(error)}`, 0, path, { cause: error });
      }
      if (response.ok) return (await response.json()) as T;
      if (RETRY_STATUSES.has(response.status) && versuch < MAX_RETRIES) {
        await runtime.sleep(parseRetryAfter(response.headers.get("retry-after"), runtime.now()) ?? backoff(versuch));
        continue;
      }
      throw new EtsyApiError(await errorText(response, path), response.status, path);
    }
  }

  return {
    tokens: () => tokens,

    async shop(): Promise<EtsyShop> {
      const me = await request<{ user_id?: number; shop_id?: number }>("/users/me");
      if (!me.user_id) throw new EtsyApiError("Etsy nennt kein Konto zum Zugangstoken.", 400, "/users/me");
      const answer = await request<unknown>(`/users/${me.user_id}/shops`);
      // Etsy antwortet hier je nach App mit einer Liste ({ count, results }) oder mit einem einzelnen Shop
      const liste = Array.isArray(answer)
        ? answer
        : Array.isArray((answer as { results?: unknown[] }).results)
          ? (answer as { results: unknown[] }).results
          : [answer];
      const shop = liste.find((eintrag): eintrag is { shop_id?: number; shop_name?: string } =>
        Boolean(eintrag && typeof eintrag === "object" && (eintrag as { shop_id?: number }).shop_id),
      );
      // /users/me nennt die Kennung des Shops schon selbst; sie gilt, wenn die Abfrage nichts hergibt
      const shopId = shop?.shop_id ?? me.shop_id;
      if (!shopId) throw new EtsyApiError("Zum Etsy-Konto gehört kein Shop.", 404, "/users/me/shops");
      return { shopId: String(shopId), shopName: shop?.shop_name ?? "" };
    },

    async ledger(from: number, to: number): Promise<EtsyLedgerEntry[]> {
      const out: EtsyLedgerEntry[] = [];
      for (let start = from; start <= to; start += ETSY_MAX_WINDOW_SECONDS) {
        const ende = Math.min(start + ETSY_MAX_WINDOW_SECONDS, to);
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const page = await request<{ count: number; results: EtsyLedgerEntry[] }>(`/shops/${options.shopId}/payment-account/ledger-entries`, {
            min_created: String(start),
            max_created: String(ende),
            limit: String(PAGE_SIZE),
            offset: String(offset),
          });
          const results = page.results ?? [];
          out.push(...results);
          if (results.length === 0 || offset + PAGE_SIZE >= (page.count ?? 0)) break;
          await runtime.sleep(250);
        }
      }
      return out.sort((a, b) => (a.created_timestamp ?? 0) - (b.created_timestamp ?? 0));
    },

    ordersFor: (ledgerEntryIds) => bestellungenZu(request, options.shopId, runtime, ledgerEntryIds),
    countriesFor: (receiptIds, zeitraum) => laenderZu(request, options.shopId, runtime, receiptIds, zeitraum),
  };
}

type EtsyRequest = <T>(path: string, params?: Record<string, string>) => Promise<T>;

/**
 * Bestellnummern zu Verkaufs- und Erstattungszeilen. Etsy will hier die Kennung der Verlaufszeile (`entry_id`), nicht
 * die Zahlungsnummer aus `reference_id`; die Antwort nennt je Zahlung die Bestellnummer und die Zahlungs- bzw.
 * Erstattungsnummer, über die der Aufrufer sie zuordnet.
 */
async function bestellungenZu(request: EtsyRequest, shopId: string, runtime: ResolvedRuntime, ledgerEntryIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const eindeutig = [...new Set(ledgerEntryIds.filter(Boolean))];
  for (let i = 0; i < eindeutig.length; i += PAYMENT_BATCH) {
    const teil = eindeutig.slice(i, i + PAYMENT_BATCH);
    const answer = await request<{ results: EtsyPayment[] }>(`/shops/${shopId}/payment-account/ledger-entries/payments`, {
      ledger_entry_ids: teil.join(","),
    });
    for (const payment of answer.results ?? []) {
      const bestellung = payment.receipt_id ? String(payment.receipt_id) : undefined;
      if (!bestellung) continue;
      if (payment.payment_id) out.set(String(payment.payment_id), bestellung);
      for (const adjustment of payment.payment_adjustments ?? []) {
        if (adjustment.payment_adjustment_id) out.set(String(adjustment.payment_adjustment_id), bestellung);
      }
    }
    await runtime.sleep(250);
  }
  return out;
}

type EtsyReceipt = { receipt_id?: number | string; country_iso?: string | null };

/**
 * Land des Käufers je Bestellnummer aus dem Receipt (`country_iso`); Bestellungen ohne Land fehlen in der Antwort. Mit
 * Zeitraum zuerst die Liste GET /shops/{shop_id}/receipts (je Seite 100, in 31-Tage-Fenstern), dann einzeln nur, was dort
 * fehlt, etwa eine Erstattung zu einer älteren Bestellung.
 */
async function laenderZu(
  request: EtsyRequest,
  shopId: string,
  runtime: ResolvedRuntime,
  receiptIds: string[],
  zeitraum?: { from: number; to: number },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const offen = new Set(receiptIds.filter(Boolean));
  const merke = (receipt: EtsyReceipt, id: string) => {
    const land = receipt.country_iso?.trim().toUpperCase();
    if (land) out.set(id, land);
    offen.delete(id);
  };
  for (let start = zeitraum?.from ?? 0; zeitraum && offen.size > 0 && start <= zeitraum.to; start += ETSY_MAX_WINDOW_SECONDS) {
    const ende = Math.min(start + ETSY_MAX_WINDOW_SECONDS, zeitraum.to);
    for (let offset = 0; offen.size > 0; offset += PAGE_SIZE) {
      const page = await request<{ count?: number; results?: EtsyReceipt[] }>(`/shops/${shopId}/receipts`, {
        min_created: String(start),
        max_created: String(ende),
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const results = page.results ?? [];
      for (const receipt of results) {
        const id = String(receipt.receipt_id ?? "");
        if (offen.has(id)) merke(receipt, id);
      }
      await runtime.sleep(250);
      if (results.length === 0 || offset + PAGE_SIZE >= (page.count ?? 0)) break;
    }
  }
  for (const id of [...offen]) {
    merke(await request<EtsyReceipt>(`/shops/${shopId}/receipts/${id}`, {}), id);
    await runtime.sleep(250);
  }
  return out;
}

async function errorText(response: Response, path: string): Promise<string> {
  const text = await response.text().catch(() => "");
  let meldung = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: string; error_description?: string };
    meldung = parsed.error_description ?? parsed.error ?? meldung;
  } catch {
    // kein JSON: der Text bleibt
  }
  if (response.status === 401) return `Etsy weist das Zugangstoken ab (${path}). Die Verbindung muss neu hergestellt werden.`;
  if (response.status === 403) return `Der Etsy-App fehlt das Recht für ${path} (transactions_r nötig).`;
  if (response.status === 429) return "Etsy bremst die Abfragen (Rate-Limit); der nächste Abruf holt den Rest.";
  return `Etsy antwortet mit ${response.status}: ${meldung || "ohne Meldung"}`;
}

/** Felder der Token-Antwort von Etsy */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Zugangstoken aus der Antwort; ohne neues Erneuerungstoken gilt das alte weiter */
export function tokenFromResponse(raw: unknown, altesRefreshToken: string, nowMs: number): EtsyTokens {
  const antwort = (raw ?? {}) as TokenResponse;
  if (!antwort.access_token) {
    throw new EtsyApiError(`Etsy gibt kein Zugangstoken zurück: ${antwort.error_description ?? antwort.error ?? "unbekannte Antwort"}`, 400, "/oauth/token");
  }
  return {
    accessToken: antwort.access_token,
    refreshToken: antwort.refresh_token ?? altesRefreshToken,
    // Etsy gibt 3600 Sekunden; ohne Angabe gilt eine Stunde
    expiresAt: Math.floor(nowMs / 1000) + (antwort.expires_in ?? 3600),
  };
}

/** Code-Verifier und Challenge der Anmeldung (PKCE, S256) */
export function createPkce(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): {
  verifier: string;
  challenge: string;
} {
  const verifier = base64url(random(64));
  const challenge = base64url(new Uint8Array(createHash("sha256").update(verifier).digest()));
  return { verifier, challenge };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Adresse der Anmeldung; `state` schützt vor fremden Rücksprüngen */
export function authorizationUrl(options: {
  keystring: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
  authUrl?: string;
}): string {
  const url = new URL(options.authUrl ?? ETSY_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientIdOf(options.keystring));
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", options.scopes);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Tauscht den Rücksprung-Code gegen Zugangs- und Erneuerungstoken */
export async function exchangeCode(options: {
  keystring: string;
  redirectUri: string;
  code: string;
  verifier: string;
  tokenUrl?: string;
  runtime?: EtsyRuntime;
}): Promise<EtsyTokens> {
  const runtime = resolveRuntime(options.runtime);
  const response = await runtime.fetch(options.tokenUrl ?? ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientIdOf(options.keystring),
      redirect_uri: options.redirectUri,
      code: options.code,
      code_verifier: options.verifier,
    }),
  });
  if (!response.ok) {
    throw new EtsyApiError(`Etsy nimmt den Rücksprung-Code nicht an (${response.status}).`, response.status, "/oauth/token");
  }
  return tokenFromResponse(await response.json(), "", runtime.now());
}
