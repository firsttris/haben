import { z } from "zod";
import { parseContentDispositionFilename } from "../lexoffice/client.ts";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";
import {
  type FbContact,
  type FbCustomer,
  type FbEnvelope,
  type FbExpense,
  type FbFile,
  type FbInvoice,
  fbContactSchema,
  fbCustomerSchema,
  fbEnvelopeSchema,
  fbExpenseSchema,
  fbInvoiceSchema,
} from "./types.ts";

export const FASTBILL_DEFAULT_URL = "https://my.fastbill.com/api/1.0/api.php";

/** Höchstens 100 Einträge je Aufruf, unabhängig von LIMIT (Grundlagen der API-Doku). */
const PAGE_SIZE = 100;
/** Schutz gegen eine Endlosschleife, falls die API immer volle Seiten liefert. */
const MAX_PAGES = 10_000;
const HOUR_MS = 3_600_000;
/** Durchläufe für invoice.get: Rechnungen, Gutschriften, Stornierte. Entwürfe (TYPE draft) sind keine Belege. */
const INVOICE_PASSES: readonly Record<string, string>[] = [{ TYPE: "outgoing" }, { TYPE: "credit" }, { STATE: "canceled" }];
/** Kleinster Tarif (Solo): 50 Aufrufe je Stunde und Konto. */
const DEFAULT_CALLS_PER_HOUR = 50;

/** Fehler beim Zugriff auf die FastBill-API (HTTP-Fehler, Netzwerk, ERRORS in der Antwort, unerwartete Antwort). */
export class FastbillApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern. Bei ERRORS oder Schemafehlern der (erfolgreiche) Status der Antwort. */
  readonly status: number;
  /** Aufgerufener Dienst, z. B. "invoice.get", oder "document" beim Laden eines PDFs */
  readonly service: string;
  constructor(message: string, status: number, service: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FastbillApiError";
    this.status = status;
    this.service = service;
  }
}

export interface FastbillClientOptions {
  /** Login-E-Mail des FastBill-Kontos (Benutzername der Basic-Anmeldung) */
  email: string;
  apiKey: string;
  /** Standard "https://my.fastbill.com/api/1.0/api.php" */
  url?: string;
  fetch?: typeof fetch;
  /** Aufrufe je Stunde laut Tarif: Solo 50 (Standard), Solo-Plus 100, Pro 500, Premium 1000. */
  callsPerHour?: number;
  /**
   * Startzeiten früherer Aufrufe (ms), etwa aus einem abgebrochenen Lauf derselben Stunde. Sie zählen auf die
   * Stundengrenze an, damit ein Neustart nicht sofort über die Grenze geht.
   */
  previousCalls?: readonly number[];
  /** Mindestabstand zwischen zwei Aufrufen (Standard 250 ms). */
  minIntervalMs?: number;
  /** Wiederholungen bei 429/502/503/504 und Netzwerkfehlern (Standard 5). */
  maxRetries?: number;
  /** Meldet, wie lange der Client wegen der Stundengrenze wartet, etwa für die Fortschrittsanzeige. */
  onRateLimitWait?: (ms: number) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Uhr für die Drosselung (Standard Date.now) – für Tests injizierbar. */
  now?: () => number;
  signal?: AbortSignal;
}

interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

/**
 * Lesender Client für die FastBill-API 1.0. Jeder Aufruf ist ein POST an denselben Endpunkt mit
 * { SERVICE, FILTER, LIMIT, OFFSET }; angemeldet wird mit Basic Auth aus Login-E-Mail und API-Schlüssel.
 *
 * Alle Aufrufe laufen nacheinander durch eine Drossel, die neben dem Mindestabstand die Stundengrenze des
 * Tarifs einhält: Sind in der letzten Stunde schon callsPerHour Aufrufe gestartet, wartet sie, bis der
 * älteste eine Stunde zurückliegt. PDFs hinter DOCUMENT_URL sind keine API-Aufrufe: Im echten Konto (November 2026)
 * lieferte die Adresse das PDF ohne Anmeldung, deshalb gehen sie ohne Zugangsdaten und nur mit dem Mindestabstand.
 *
 * Die zurückgegebenen Objekte sind das vollständige JSON der API und können so archiviert werden.
 */
export class FastbillClient {
  readonly #auth: string;
  readonly #url: string;
  readonly #fetch: typeof fetch;
  readonly #callsPerHour: number;
  readonly #minIntervalMs: number;
  readonly #maxRetries: number;
  readonly #onRateLimitWait: ((ms: number) => void) | undefined;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #signal: AbortSignal | undefined;
  #gate: Promise<void> = Promise.resolve();
  #fileGate: Promise<void> = Promise.resolve();
  #lastFileStart: number | null = null;
  /** Startzeiten der Aufrufe in der letzten Stunde, aufsteigend */
  #starts: number[];

  constructor(options: FastbillClientOptions) {
    const email = options.email.trim();
    const apiKey = options.apiKey.trim();
    if (!email) throw new Error("Login-E-Mail fehlt");
    if (!apiKey) throw new Error("API-Schlüssel fehlt");
    this.#auth = `Basic ${Buffer.from(`${email}:${apiKey}`).toString("base64")}`;
    this.#url = options.url ?? FASTBILL_DEFAULT_URL;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#callsPerHour = Math.max(1, Math.floor(options.callsPerHour ?? DEFAULT_CALLS_PER_HOUR));
    this.#minIntervalMs = options.minIntervalMs ?? 250;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#onRateLimitWait = options.onRateLimitWait;
    this.#signal = options.signal;
    this.#sleep = options.sleep ?? ((ms) => abortableSleep(ms, this.#signal));
    this.#now = options.now ?? Date.now;
    this.#starts = [...(options.previousCalls ?? [])].sort((a, b) => a - b);
  }

  /** Startzeiten der Aufrufe der letzten Stunde, zum Speichern für einen späteren Neustart. */
  recentCalls(): number[] {
    const since = this.#now() - HOUR_MS;
    return this.#starts.filter((t) => t > since);
  }

  // ------------------------------------------------------------ Dienste

  /** Prüft die Zugangsdaten mit einem einzelnen Kunden-Abruf. */
  async verify(): Promise<void> {
    await this.#call("customer.get", {}, 1, 0);
  }

  customers(): AsyncGenerator<FbCustomer> {
    return this.#pages("customer.get", "CUSTOMERS", {}, fbCustomerSchema, "CUSTOMER_ID");
  }

  /** Ansprechpartner aller Kunden */
  contacts(): AsyncGenerator<FbContact> {
    return this.#pages("contact.get", "CONTACTS", {}, fbContactSchema, "CONTACT_ID");
  }

  /**
   * Ausgangsrechnungen und Gutschriften samt Stornos, ohne Entwürfe. Ohne Filter auf TYPE lieferte ein echtes Konto
   * (November 2026) auf der ersten Seite nur Entwürfe; deshalb je Art ein eigener Durchlauf und zur Sicherheit einer
   * über STATE canceled. Doppelte Rechnungen aus mehreren Durchläufen kommen nur einmal.
   */
  async *invoices(filter: Record<string, string> = {}): AsyncGenerator<FbInvoice> {
    const seen = new Set<string>();
    for (const pass of INVOICE_PASSES) {
      yield* this.#pages("invoice.get", "INVOICES", { ...filter, ...pass }, fbInvoiceSchema, "INVOICE_ID", seen);
    }
  }

  expenses(filter: Record<string, string> = {}): AsyncGenerator<FbExpense> {
    return this.#pages("expense.get", "EXPENSES", filter, fbExpenseSchema, "INVOICE_ID");
  }

  /**
   * PDF hinter DOCUMENT_URL, ohne Zugangsdaten: Die Adresse ist ein Link mit eigenem Schlüssel im Pfad. Nur https-Adressen
   * von FastBill. null, wenn FastBill keine Datei herausgibt (403, 404) oder eine HTML-Antwort liefert; im echten Konto
   * kam bei Ausgaben ohne Beleg eine leere HTML-Antwort mit Status 200.
   */
  async document(documentUrl: string): Promise<FbFile | null> {
    let url: URL;
    try {
      url = new URL(documentUrl);
    } catch {
      throw new FastbillApiError("DOCUMENT_URL ist keine gültige Adresse", 0, "document");
    }
    if (url.protocol !== "https:" || !isFastbillHost(url.hostname)) {
      throw new FastbillApiError(`DOCUMENT_URL zeigt nicht auf FastBill (${url.hostname})`, 0, "document");
    }
    let res: RawResponse;
    try {
      res = await this.#request("document", url.toString(), { method: "GET", accept: "application/pdf, */*", api: false });
    } catch (e) {
      if (e instanceof FastbillApiError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    }
    const type = contentType(res.headers);
    if (type.includes("html") || res.bytes.byteLength === 0) return null;
    const disposition = res.headers.get("content-disposition");
    return {
      bytes: res.bytes,
      mimeType: type || "application/octet-stream",
      filename: disposition ? parseContentDispositionFilename(disposition) : null,
    };
  }

  // ------------------------------------------------------------ Interna

  async *#pages<S extends z.ZodType>(
    service: string,
    listKey: string,
    filter: Record<string, string>,
    item: S,
    idKey: string,
    seen = new Set<string>(),
  ): AsyncGenerator<z.infer<S>> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const envelope = await this.#call(service, filter, PAGE_SIZE, page * PAGE_SIZE);
      const raw = listOf(envelope.RESPONSE, listKey);
      const parsed = z.array(item).safeParse(raw);
      if (!parsed.success) throw new FastbillApiError(`Unerwartete Antwort von ${service}: ${describeIssues(parsed.error.issues, listKey)}`, 200, service);
      for (const o of parsed.data) {
        const key = String((o as Record<string, unknown>)[idKey]);
        if (seen.has(key)) continue;
        seen.add(key);
        yield o;
      }
      if (raw.length < PAGE_SIZE) return;
    }
    throw new FastbillApiError(`Zu viele Seiten bei ${service} – Abbruch`, 0, service);
  }

  async #call(service: string, filter: Record<string, string>, limit: number, offset: number): Promise<FbEnvelope> {
    const body = JSON.stringify({ SERVICE: service, FILTER: filter, LIMIT: limit, OFFSET: offset });
    const res = await this.#request(service, this.#url, { method: "POST", accept: "application/json", body, api: true });
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(res.bytes));
    } catch (cause) {
      throw new FastbillApiError(`Antwort von ${service} ist kein gültiges JSON`, res.status, service, { cause });
    }
    const parsed = fbEnvelopeSchema.safeParse(data);
    if (!parsed.success) throw new FastbillApiError(`Unerwartete Antwort von ${service}: ${describeIssues(parsed.error.issues)}`, res.status, service);
    const errors = errorTexts(parsed.data.RESPONSE.ERRORS);
    if (errors.length) throw new FastbillApiError(`FastBill meldet bei ${service}: ${errors.join("; ")}`, res.status, service);
    return parsed.data;
  }

  /** api: Aufruf der API mit Anmeldung, der auf die Stundengrenze zählt; sonst ein Dateiabruf ohne Zugangsdaten. */
  async #request(service: string, url: string, init: { method: "GET" | "POST"; accept: string; body?: string; api: boolean }): Promise<RawResponse> {
    for (let attempt = 0; ; attempt++) {
      this.#checkAborted(service);
      await (init.api ? this.#throttle() : this.#throttleFile());
      this.#checkAborted(service);
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method: init.method,
          headers: {
            ...(init.api ? { Authorization: this.#auth } : {}),
            Accept: init.accept,
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: init.body,
          signal: this.#signal,
          // Eine Weiterleitung könnte die Anmeldung an einen anderen Host tragen; Dateiabrufe haben keine.
          redirect: init.api ? "error" : "follow",
        });
      } catch (cause) {
        if (this.#signal?.aborted || isAbortError(cause)) throw new FastbillApiError("Import abgebrochen", 0, service, { cause });
        if (attempt < this.#maxRetries) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        throw new FastbillApiError(`Netzwerkfehler bei ${service}: ${msg}`, 0, service, { cause });
      }

      if (res.ok) return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };

      await res.body?.cancel().catch(() => undefined);
      if (RETRY_STATUSES.has(res.status) && attempt < this.#maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.#now());
        await this.#sleep(retryAfter ?? backoff(attempt));
        continue;
      }
      throw new FastbillApiError(errorMessage(res.status, service), res.status, service);
    }
  }

  /** Serialisiert die Aufrufe: Mindestabstand und höchstens callsPerHour Starts in jeder Stunde. */
  #throttle(): Promise<void> {
    const next = this.#gate.then(async () => {
      const last = this.#starts.at(-1);
      if (last !== undefined) {
        const wait = last + this.#minIntervalMs - this.#now();
        if (wait > 0) await this.#sleep(wait);
      }
      this.#starts = this.#starts.filter((t) => t > this.#now() - HOUR_MS);
      if (this.#starts.length >= this.#callsPerHour) {
        const oldest = this.#starts[this.#starts.length - this.#callsPerHour]!;
        const wait = oldest + HOUR_MS - this.#now();
        if (wait > 0) {
          this.#onRateLimitWait?.(wait);
          await this.#sleep(wait);
        }
      }
      this.#starts.push(this.#now());
    });
    // Ein Fehler (z. B. Abbruch im sleep) darf die Kette nicht dauerhaft blockieren.
    this.#gate = next.catch(() => undefined);
    return next;
  }

  /** Dateiabrufe: nur der Mindestabstand untereinander, unabhängig von den API-Aufrufen. */
  #throttleFile(): Promise<void> {
    const next = this.#fileGate.then(async () => {
      if (this.#lastFileStart !== null) {
        const wait = this.#lastFileStart + this.#minIntervalMs - this.#now();
        if (wait > 0) await this.#sleep(wait);
      }
      this.#lastFileStart = this.#now();
    });
    this.#fileGate = next.catch(() => undefined);
    return next;
  }

  #checkAborted(service: string): void {
    if (this.#signal?.aborted) throw new FastbillApiError("Import abgebrochen", 0, service, { cause: this.#signal.reason });
  }
}

// ------------------------------------------------------------ Hilfsfunktionen

/**
 * Liste aus RESPONSE. Fehlt der erwartete Schlüssel, nimmt sie die einzige Liste der Antwort: Die Doku nennt
 * die Namen nur für Kunden. Ein einzelnes Objekt statt einer Liste wird zur Liste mit einem Eintrag; keine
 * Liste heißt keine Einträge.
 */
function listOf(response: Record<string, unknown>, key: string): unknown[] {
  let value = response[key];
  if (value === undefined) {
    const lists = Object.entries(response).filter(([k, v]) => k !== "ERRORS" && (Array.isArray(v) || (v !== null && typeof v === "object")));
    if (lists.length === 1) value = lists[0]![1];
  }
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function errorTexts(errors: FbEnvelope["RESPONSE"]["ERRORS"]): string[] {
  if (errors === undefined || errors === null) return [];
  const items = Array.isArray(errors) ? errors : [errors];
  return items
    .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "" && t !== "{}");
}

function isFastbillHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "fastbill.com" || host.endsWith(".fastbill.com");
}

function contentType(headers: Headers): string {
  return (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

function describeIssues(issues: readonly z.core.$ZodIssue[], prefix?: string): string {
  const shown = issues
    .slice(0, 3)
    .map((i) => {
      const path = [...(prefix ? [prefix] : []), ...i.path.map(String)];
      return `Feld „${path.length ? path.join(".") : "(Wurzel)"}“: ${i.message}`;
    })
    .join("; ");
  return issues.length > 3 ? `${shown} (und ${issues.length - 3} weitere)` : shown;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(status: number, service: string): string {
  if (status === 401) return "Login-E-Mail oder API-Schlüssel falsch";
  if (status === 403) return "Kein Zugriff – das FastBill-Konto erlaubt keinen API-Zugriff";
  if (status === 429) return `Aufruflimit der FastBill-API überschritten (${service}), auch nach mehreren Versuchen`;
  return `FastBill-API-Fehler ${status} bei ${service}`;
}
