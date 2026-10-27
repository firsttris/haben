import type { z } from "zod";
import { parseContentDispositionFilename } from "../lexoffice/client.ts";
import { backoff, parseRetryAfter, RETRY_STATUSES } from "../retry.ts";
import {
  listSchema,
  sevBookkeepingVersionSchema,
  sevCommunicationWaySchema,
  sevContactAddressSchema,
  sevContactSchema,
  sevCreditNoteSchema,
  sevDocumentPosSchema,
  sevFileBodySchema,
  sevFileResponseSchema,
  sevInvoiceSchema,
  sevVoucherPosSchema,
  sevVoucherSchema,
  type SevCommunicationWay,
  type SevContact,
  type SevContactAddress,
  type SevCreditNote,
  type SevDocumentPos,
  type SevFile,
  type SevInvoice,
  type SevVoucher,
  type SevVoucherPos,
} from "./types.ts";

export const SEVDESK_DEFAULT_BASE_URL = "https://my.sevdesk.de/api/v1";

const PAGE_SIZE = 100;
/** Schutz gegen eine Endlosschleife, falls die API immer volle Seiten liefert. */
const MAX_PAGES = 10_000;

/** Fehler beim Zugriff auf die sevDesk-API (HTTP-Fehler, Netzwerk, unerwartete Antwort). */
export class SevdeskApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern. Bei Schemafehlern der (erfolgreiche) Status der Antwort. */
  readonly status: number;
  /** Angefragter Pfad relativ zur Basis-URL, z. B. "/Invoice/…" */
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SevdeskApiError";
    this.status = status;
    this.path = path;
  }
}

export interface SevdeskClientOptions {
  apiKey: string;
  /** Standard "https://my.sevdesk.de/api/v1" */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Mindestabstand zwischen zwei Request-Starts (Standard 250 ms). */
  minIntervalMs?: number;
  /** Wiederholungen bei 429/502/503/504 und Netzwerkfehlern (Standard 5). */
  maxRetries?: number;
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
 * Lesender Client für die sevDesk-API. Alle Requests laufen nacheinander durch eine Drossel.
 * Der API-Token steht unverändert im Header Authorization.
 *
 * Die zurückgegebenen Objekte sind das vollständige JSON der API und können so archiviert werden.
 */
export class SevdeskClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #minIntervalMs: number;
  readonly #maxRetries: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #signal: AbortSignal | undefined;
  #gate: Promise<void> = Promise.resolve();
  #lastStart: number | null = null;

  constructor(options: SevdeskClientOptions) {
    if (!options.apiKey.trim()) throw new Error("API-Token fehlt");
    this.#apiKey = options.apiKey.trim();
    this.#baseUrl = (options.baseUrl ?? SEVDESK_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#minIntervalMs = options.minIntervalMs ?? 250;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#signal = options.signal;
    this.#sleep = options.sleep ?? ((ms) => abortableSleep(ms, this.#signal));
    this.#now = options.now ?? Date.now;
  }

  // ------------------------------------------------------------ Endpunkte

  /** "1.0" oder "2.0"; dient zugleich als Prüfung des Tokens. */
  async bookkeepingSystemVersion(): Promise<string> {
    const data = await this.#json("/Tools/bookkeepingSystemVersion", {}, sevBookkeepingVersionSchema);
    return data.objects.version ?? "";
  }

  /** Alle Kontakte, Organisationen und Personen (depth=1). */
  contacts(): AsyncGenerator<SevContact> {
    return this.#pages("/Contact", { depth: "1" }, sevContactSchema);
  }

  /** Alle Adressen; mit dem Land samt ISO-Code. */
  contactAddresses(): AsyncGenerator<SevContactAddress> {
    return this.#pages("/ContactAddress", { embed: "country" }, sevContactAddressSchema);
  }

  /** Alle E-Mail-Adressen. */
  emailAddresses(): AsyncGenerator<SevCommunicationWay> {
    return this.#pages("/CommunicationWay", { type: "EMAIL" }, sevCommunicationWaySchema);
  }

  invoices(): AsyncGenerator<SevInvoice> {
    return this.#pages("/Invoice", {}, sevInvoiceSchema);
  }

  creditNotes(): AsyncGenerator<SevCreditNote> {
    return this.#pages("/CreditNote", {}, sevCreditNoteSchema);
  }

  vouchers(): AsyncGenerator<SevVoucher> {
    return this.#pages("/Voucher", {}, sevVoucherSchema);
  }

  async invoicePositions(invoiceId: string): Promise<SevDocumentPos[]> {
    return this.#all(`/Invoice/${enc(invoiceId)}/getPositions`, {}, sevDocumentPosSchema);
  }

  async creditNotePositions(creditNoteId: string): Promise<SevDocumentPos[]> {
    return this.#all("/CreditNotePos", { "creditNote[id]": creditNoteId, "creditNote[objectName]": "CreditNote" }, sevDocumentPosSchema);
  }

  async voucherPositions(voucherId: string): Promise<SevVoucherPos[]> {
    return this.#all("/VoucherPos", { "voucher[id]": voucherId, "voucher[objectName]": "Voucher" }, sevVoucherPosSchema);
  }

  /** PDF einer Rechnung. preventSendBy: der Abruf darf die Rechnung nicht als versendet markieren. */
  async invoicePdf(invoiceId: string): Promise<SevFile | null> {
    return this.#optionalFile(`/Invoice/${enc(invoiceId)}/getPdf`, { preventSendBy: "true" });
  }

  async creditNotePdf(creditNoteId: string): Promise<SevFile | null> {
    return this.#optionalFile(`/CreditNote/${enc(creditNoteId)}/getPdf`, { preventSendBy: "true" });
  }

  /** E-Rechnungs-XML; null, wenn die Rechnung keine E-Rechnung ist. */
  async invoiceXml(invoiceId: string): Promise<SevFile | null> {
    const path = `/Invoice/${enc(invoiceId)}/getXml`;
    let res: RawResponse;
    try {
      res = await this.#request(path, {}, "application/json, application/xml");
    } catch (e) {
      if (isStatus(e, 400, 404, 406, 422)) return null;
      throw e;
    }
    const text = new TextDecoder().decode(res.bytes);
    let xml = text;
    if (contentType(res.headers).includes("json")) {
      try {
        const objects = (JSON.parse(text) as { objects?: unknown }).objects;
        xml = typeof objects === "string" ? objects : "";
      } catch {
        xml = "";
      }
    }
    if (!xml.trimStart().startsWith("<")) return null;
    return { bytes: new TextEncoder().encode(xml), mimeType: "application/xml", filename: null };
  }

  /** Datei eines Belegs (Document); null, wenn sevDesk sie nicht herausgibt (404). */
  async document(documentId: string): Promise<SevFile | null> {
    return this.#optionalFile(`/Document/${enc(documentId)}/download`, {});
  }

  // ------------------------------------------------------------ Interna

  async *#pages<S extends z.ZodType>(path: string, query: Record<string, string>, item: S): AsyncGenerator<z.infer<S>> {
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const objects = await this.#list(path, { ...query, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) }, item);
      for (const o of objects) {
        const key = String((o as { id: string | number }).id);
        if (seen.has(key)) continue;
        seen.add(key);
        yield o;
      }
      if (objects.length < PAGE_SIZE) return;
    }
    throw new SevdeskApiError(`Zu viele Seiten bei ${path} – Abbruch`, 0, path);
  }

  async #all<S extends z.ZodType>(path: string, query: Record<string, string>, item: S): Promise<z.infer<S>[]> {
    const out: z.infer<S>[] = [];
    for await (const o of this.#pages(path, query, item)) out.push(o);
    return out;
  }

  async #list<S extends z.ZodType>(path: string, query: Record<string, string>, item: S): Promise<z.infer<S>[]> {
    const data = (await this.#json(path, query, listSchema(item))) as { objects: z.infer<S>[] };
    return data.objects;
  }

  async #json<S extends z.ZodType>(path: string, query: Record<string, string>, schema: S): Promise<z.infer<S>> {
    const res = await this.#request(path, query, "application/json");
    return parseJson(res, path, schema);
  }

  async #optionalFile(path: string, query: Record<string, string>): Promise<SevFile | null> {
    let res: RawResponse;
    try {
      res = await this.#request(path, query, "application/json, application/pdf, */*");
    } catch (e) {
      if (isStatus(e, 400, 404)) return null;
      throw e;
    }
    const type = contentType(res.headers);
    if (!type.includes("json")) {
      const disposition = res.headers.get("content-disposition");
      return {
        bytes: res.bytes,
        mimeType: type || "application/octet-stream",
        filename: disposition ? parseContentDispositionFilename(disposition) : null,
      };
    }
    const parsed = parseJson(res, path, sevFileResponseSchema);
    const body = ("objects" in parsed ? parsed.objects : parsed) as z.infer<typeof sevFileBodySchema>;
    const base64 = body.base64encoded ?? body.base64Encoded ?? true;
    const bytes = base64 ? Uint8Array.from(Buffer.from(body.content, "base64")) : new TextEncoder().encode(body.content);
    if (bytes.byteLength === 0) return null;
    return {
      bytes,
      mimeType: (body.mimeType ?? body.mimetype ?? "application/pdf").split(";")[0]!.trim().toLowerCase() || "application/octet-stream",
      filename: body.filename ? (parseContentDispositionFilename(`attachment; filename="${body.filename.replace(/"/g, "")}"`) ?? null) : null,
    };
  }

  async #request(path: string, query: Record<string, string>, accept: string): Promise<RawResponse> {
    const params = new URLSearchParams(query).toString();
    const url = this.#baseUrl + path + (params ? `?${params}` : "");
    for (let attempt = 0; ; attempt++) {
      this.#checkAborted(path);
      await this.#throttle();
      this.#checkAborted(path);
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method: "GET",
          headers: { Authorization: this.#apiKey, Accept: accept },
          signal: this.#signal,
        });
      } catch (cause) {
        if (this.#signal?.aborted || isAbortError(cause)) {
          throw new SevdeskApiError("Import abgebrochen", 0, path, { cause });
        }
        if (attempt < this.#maxRetries) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        throw new SevdeskApiError(`Netzwerkfehler bei GET ${path}: ${msg}`, 0, path, { cause });
      }

      if (res.ok) {
        return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
      }

      const body = await res.text().catch(() => "");
      if (RETRY_STATUSES.has(res.status) && attempt < this.#maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.#now());
        await this.#sleep(retryAfter ?? backoff(attempt));
        continue;
      }
      throw new SevdeskApiError(errorMessage(res.status, path, body), res.status, path);
    }
  }

  /** Serialisiert die Request-Starts mit mindestens minIntervalMs Abstand. */
  #throttle(): Promise<void> {
    const next = this.#gate.then(async () => {
      if (this.#lastStart !== null) {
        const wait = this.#lastStart + this.#minIntervalMs - this.#now();
        if (wait > 0) await this.#sleep(wait);
      }
      this.#lastStart = this.#now();
    });
    // Ein Fehler (z. B. Abbruch im sleep) darf die Kette nicht dauerhaft blockieren.
    this.#gate = next.catch(() => undefined);
    return next;
  }

  #checkAborted(path: string): void {
    if (this.#signal?.aborted) throw new SevdeskApiError("Import abgebrochen", 0, path, { cause: this.#signal.reason });
  }
}

// ------------------------------------------------------------ Hilfsfunktionen

function enc(id: string): string {
  return encodeURIComponent(id);
}

function contentType(headers: Headers): string {
  return (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

function parseJson<S extends z.ZodType>(res: RawResponse, path: string, schema: S): z.infer<S> {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(res.bytes));
  } catch (cause) {
    throw new SevdeskApiError(`Antwort von GET ${path} ist kein gültiges JSON`, res.status, path, { cause });
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const shown = issues
      .slice(0, 3)
      .map((i) => `Feld „${i.path.length ? i.path.map(String).join(".") : "(Wurzel)"}“: ${i.message}`)
      .join("; ");
    const more = issues.length > 3 ? ` (und ${issues.length - 3} weitere)` : "";
    throw new SevdeskApiError(`Unerwartete Antwort von GET ${path}: ${shown}${more}`, res.status, path);
  }
  return parsed.data;
}

function isStatus(e: unknown, ...statuses: number[]): boolean {
  return e instanceof SevdeskApiError && statuses.includes(e.status);
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

function errorMessage(status: number, path: string, body: string): string {
  if (status === 401) return "API-Token ungültig oder abgelaufen";
  if (status === 403) return "Kein Zugriff – der API-Token hat keine Berechtigung";
  if (status === 429) return `Rate-Limit der sevDesk-API überschritten (GET ${path}), auch nach mehreren Versuchen`;
  const detail = apiErrorDetail(body);
  const prefix = status === 404 ? `Nicht gefunden: GET ${path}` : `sevDesk-API-Fehler ${status} bei GET ${path}`;
  return detail ? `${prefix} – ${detail}` : prefix;
}

/** Fehlertext aus { error: { message } } bzw. { message } ziehen. */
function apiErrorDetail(body: string): string {
  if (!body) return "";
  let text = body;
  try {
    const j = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } };
    if (typeof j.error?.message === "string") text = j.error.message;
    else if (typeof j.message === "string") text = j.message;
  } catch {
    // kein JSON – Rohtext verwenden
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
