import type { z } from "zod";
import {
  lexContactSchema,
  lexDocumentFileSchema,
  lexPaymentsSchema,
  lexPostingCategoriesSchema,
  lexProfileSchema,
  lexSalesDocumentSchema,
  lexVoucherListItemSchema,
  lexVoucherSchema,
  pageSchema,
  type LexContact,
  type LexFile,
  type LexPayments,
  type LexPostingCategory,
  type LexProfile,
  type LexSalesDocument,
  type LexSalesDocumentType,
  type LexVoucher,
  type LexVoucherListItem,
  type LexVoucherListType,
} from "./types.ts";

export const LEXOFFICE_DEFAULT_BASE_URL = "https://api.lexware.io/v1";

/** Maximale Seitengröße von /voucherlist laut Doku. */
const VOUCHERLIST_PAGE_SIZE = 250;
/** /contacts: Maximum nicht sicher belegt (vermutlich 250) – 100 ist auf jeden Fall erlaubt. */
const CONTACTS_PAGE_SIZE = 100;
/** Schutz gegen eine Endlosschleife, falls die API nie `last: true` meldet. */
const MAX_PAGES = 10_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 300_000;
const FILE_ACCEPT = "application/pdf, image/*, application/xml, */*";

/** Fehler beim Zugriff auf die Lexware-Office-API (HTTP-Fehler, Netzwerk, unerwartete Antwort). */
export class LexofficeApiError extends Error {
  /** HTTP-Status; 0 bei Netzwerkfehlern. Bei Schemafehlern der (erfolgreiche) Status der Antwort. */
  readonly status: number;
  /** Angefragter Pfad relativ zur Basis-URL, z. B. "/vouchers/…" */
  readonly path: string;
  constructor(message: string, status: number, path: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LexofficeApiError";
    this.status = status;
    this.path = path;
  }
}

/** Die Antwort passt nicht zum erwarteten Schema. */
export class LexofficeSchemaError extends LexofficeApiError {
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(message: string, status: number, path: string, issues: readonly z.core.$ZodIssue[]) {
    super(message, status, path);
    this.name = "LexofficeSchemaError";
    this.issues = issues;
  }
}

export interface LexofficeClientOptions {
  apiKey: string;
  /** Standard "https://api.lexware.io/v1"; "https://api.lexoffice.io/v1" funktioniert ebenfalls. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Mindestabstand zwischen zwei Request-Starts (Standard 600 ms ≈ 1,7 Requests/s). */
  minIntervalMs?: number;
  /** Wiederholungen bei 429/502/503/504 und Netzwerkfehlern (Standard 5). */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Uhr für die Drosselung (Standard Date.now) – für Tests injizierbar. */
  now?: () => number;
  signal?: AbortSignal;
}

const SALES_PATHS: Record<LexSalesDocumentType, string> = {
  invoice: "invoices",
  creditnote: "credit-notes",
  downpaymentinvoice: "down-payment-invoices",
};

interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

/**
 * Lesender Client für die Lexware Office Public API. Alle Requests laufen
 * nacheinander durch eine Drossel (Rate-Limit ca. 2 Requests/s je Schlüssel).
 *
 * Die zurückgegebenen Objekte sind das vollständige JSON der API (Zod parst
 * "loose" und ohne Transforms) und können so archiviert werden.
 */
export class LexofficeClient {
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

  constructor(options: LexofficeClientOptions) {
    if (!options.apiKey.trim()) throw new Error("API-Schlüssel fehlt");
    this.#apiKey = options.apiKey.trim();
    this.#baseUrl = (options.baseUrl ?? LEXOFFICE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#minIntervalMs = options.minIntervalMs ?? 600;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#signal = options.signal;
    this.#sleep = options.sleep ?? ((ms) => abortableSleep(ms, this.#signal));
    this.#now = options.now ?? Date.now;
  }

  // ------------------------------------------------------------ Endpunkte

  async profile(): Promise<LexProfile> {
    return this.#json("/profile", lexProfileSchema);
  }

  async postingCategories(): Promise<LexPostingCategory[]> {
    return this.#json("/posting-categories", lexPostingCategoriesSchema);
  }

  /** Alle Kontakte (alle Seiten, nach id dedupliziert). */
  async *contacts(): AsyncGenerator<LexContact> {
    const seen = new Set<string>();
    for await (const c of this.#pages("/contacts", {}, lexContactSchema, CONTACTS_PAGE_SIZE)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      yield c;
    }
  }

  /**
   * Alle Einträge der Belegliste für die angegebenen Typen, in jedem Status,
   * archiviert und nicht archiviert. Ob ein Weglassen von `archived` beides
   * liefert, ist nicht sicher dokumentiert – daher zwei Durchläufe
   * (archived=false, dann archived=true) und Deduplizierung nach id.
   */
  async *voucherList(types: LexVoucherListType[]): AsyncGenerator<LexVoucherListItem> {
    if (types.length === 0) return;
    const seen = new Set<string>();
    for (const archived of [false, true]) {
      const query = {
        voucherType: [...new Set(types)].join(","),
        voucherStatus: "any",
        archived: String(archived),
        // Aufsteigend nach Anlage: während des Imports neu angelegte Belege landen
        // am Ende statt alle Seiten zu verschieben.
        sort: "createdDate,ASC",
      };
      for await (const item of this.#pages("/voucherlist", query, lexVoucherListItemSchema, VOUCHERLIST_PAGE_SIZE)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        yield item;
      }
    }
  }

  async salesDocument(type: LexSalesDocumentType, id: string): Promise<LexSalesDocument> {
    return this.#json(`/${SALES_PATHS[type]}/${enc(id)}`, lexSalesDocumentSchema);
  }

  /**
   * Original-PDF eines Rechnungsmodul-Belegs. Erst `GET …/{id}/file`; bei 404/406
   * Rückfall auf das ältere `GET …/{id}/document` → documentFileId → `GET /files/{id}`.
   * null, wenn es kein PDF gibt (z. B. Entwurf).
   */
  async salesDocumentPdf(type: LexSalesDocumentType, id: string): Promise<LexFile | null> {
    const base = `/${SALES_PATHS[type]}/${enc(id)}`;
    try {
      return await this.#binary(`${base}/file`, "application/pdf");
    } catch (e) {
      if (!isStatus(e, 404, 406)) throw e;
    }
    let documentFileId: string;
    try {
      documentFileId = (await this.#json(`${base}/document`, lexDocumentFileSchema)).documentFileId;
    } catch (e) {
      if (isStatus(e, 404, 406)) return null;
      throw e;
    }
    return this.file(documentFileId);
  }

  /** E-Rechnungs-XML (XRechnung/ZUGFeRD), falls vorhanden; sonst null. */
  async salesDocumentXml(type: LexSalesDocumentType, id: string): Promise<LexFile | null> {
    try {
      const f = await this.#binary(`/${SALES_PATHS[type]}/${enc(id)}/file`, "application/xml");
      // Falls die API das Accept ignoriert und doch ein PDF schickt: kein XML.
      return f.mimeType.includes("xml") ? f : null;
    } catch (e) {
      if (isStatus(e, 404, 406)) return null;
      throw e;
    }
  }

  async voucher(id: string): Promise<LexVoucher> {
    return this.#json(`/vouchers/${enc(id)}`, lexVoucherSchema);
  }

  /** Datei herunterladen (Beleg-Anhänge, Rechnungs-PDFs). */
  async file(id: string): Promise<LexFile> {
    const path = `/files/${enc(id)}`;
    try {
      return await this.#binary(path, FILE_ACCEPT);
    } catch (e) {
      if (!isStatus(e, 406)) throw e;
      return this.#binary(path, "*/*");
    }
  }

  /** Zahlungsinformationen zu einem Beleg; null, wenn die API dafür keine liefert (404). */
  async payments(voucherId: string): Promise<LexPayments | null> {
    try {
      return await this.#json(`/payments/${enc(voucherId)}`, lexPaymentsSchema);
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------ Interna

  async *#pages<S extends z.ZodType>(
    path: string,
    query: Record<string, string>,
    item: S,
    size: number,
  ): AsyncGenerator<z.infer<S>> {
    const schema = pageSchema(item);
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ ...query, page: String(page), size: String(size) });
      const data = (await this.#json(`${path}?${params.toString()}`, schema)) as {
        content: z.infer<S>[];
        last?: boolean | null;
        totalPages?: number | null;
      };
      yield* data.content;
      if (data.content.length === 0) return;
      if (data.last === true) return;
      if (typeof data.totalPages === "number" && page + 1 >= data.totalPages) return;
      if (data.last == null && data.totalPages == null && data.content.length < size) return;
    }
    throw new LexofficeApiError(`Zu viele Seiten bei ${path} – Abbruch`, 0, path);
  }

  async #json<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
    const res = await this.#request(path, "application/json");
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(res.bytes));
    } catch (cause) {
      throw new LexofficeApiError(`Antwort von GET ${path} ist kein gültiges JSON`, res.status, path, { cause });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const shown = issues.slice(0, 3).map(describeIssue).join("; ");
      const more = issues.length > 3 ? ` (und ${issues.length - 3} weitere)` : "";
      throw new LexofficeSchemaError(
        `Unerwartete Antwort von GET ${path}: ${shown}${more}`,
        res.status,
        path,
        issues,
      );
    }
    return parsed.data;
  }

  async #binary(path: string, accept: string): Promise<LexFile> {
    const res = await this.#request(path, accept);
    const contentType = res.headers.get("content-type") ?? "";
    const mimeType = contentType.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
    const disposition = res.headers.get("content-disposition");
    return { bytes: res.bytes, mimeType, filename: disposition ? parseContentDispositionFilename(disposition) : null };
  }

  async #request(path: string, accept: string): Promise<RawResponse> {
    const url = this.#baseUrl + path;
    for (let attempt = 0; ; attempt++) {
      this.#checkAborted(path);
      await this.#throttle();
      this.#checkAborted(path);
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: accept },
          signal: this.#signal,
        });
      } catch (cause) {
        if (this.#signal?.aborted || isAbortError(cause)) {
          throw new LexofficeApiError("Import abgebrochen", 0, path, { cause });
        }
        if (attempt < this.#maxRetries) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        throw new LexofficeApiError(`Netzwerkfehler bei GET ${path}: ${msg}`, 0, path, { cause });
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
      throw new LexofficeApiError(errorMessage(res.status, path, body), res.status, path);
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
    if (this.#signal?.aborted) throw new LexofficeApiError("Import abgebrochen", 0, path, { cause: this.#signal.reason });
  }
}

// ------------------------------------------------------------ Hilfsfunktionen

function enc(id: string): string {
  return encodeURIComponent(id);
}

function isStatus(e: unknown, ...statuses: number[]): boolean {
  return e instanceof LexofficeApiError && !(e instanceof LexofficeSchemaError) && statuses.includes(e.status);
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
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

/** Retry-After als Sekunden oder HTTP-Datum → Millisekunden (null, wenn unbrauchbar). */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.min(Math.round(Number(v) * 1000), MAX_RETRY_AFTER_MS);
  const date = Date.parse(v);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
}

function errorMessage(status: number, path: string, body: string): string {
  if (status === 401) return "API-Schlüssel ungültig oder abgelaufen";
  if (status === 403) {
    return "Kein Zugriff – die Public API ist nur im Tarif XL enthalten oder der Schlüssel hat keine Berechtigung";
  }
  if (status === 429) return `Rate-Limit der Lexware-API überschritten (GET ${path}), auch nach mehreren Versuchen`;
  const detail = apiErrorDetail(body);
  const prefix = status === 404 ? `Nicht gefunden: GET ${path}` : `Lexware-API-Fehler ${status} bei GET ${path}`;
  return detail ? `${prefix} – ${detail}` : prefix;
}

/** Fehlertext aus den beiden Fehlerformaten der API (message bzw. IssueList) ziehen. */
function apiErrorDetail(body: string): string {
  if (!body) return "";
  let text = body;
  try {
    const j = JSON.parse(body) as { message?: unknown; IssueList?: { i18nKey?: string; source?: string }[] };
    if (typeof j.message === "string") text = j.message;
    else if (Array.isArray(j.IssueList)) text = j.IssueList.map((i) => [i.source, i.i18nKey].filter(Boolean).join(": ")).join("; ");
  } catch {
    // kein JSON – Rohtext verwenden
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length ? issue.path.map(String).join(".") : "(Wurzel)";
  switch (issue.code) {
    case "invalid_type":
      return `Feld „${where}“: erwartet ${typeName(issue.expected)}`;
    case "invalid_union":
      return `Feld „${where}“: Wert hat keinen der erwarteten Typen`;
    default:
      return `Feld „${where}“: ${issue.message}`;
  }
}

function typeName(t: string): string {
  const names: Record<string, string> = {
    string: "Text",
    number: "Zahl",
    boolean: "Wahrheitswert",
    object: "Objekt",
    array: "Liste",
  };
  return names[t] ?? t;
}

/**
 * Dateiname aus Content-Disposition. `filename*` (RFC 5987/8187, UTF-8 oder
 * ISO-8859-1) hat Vorrang vor `filename`. Pfadanteile und Steuerzeichen werden entfernt.
 */
export function parseContentDispositionFilename(header: string): string | null {
  const star = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const decoded = decodeExtValue(star[1]!.trim().replace(/^"(.*)"$/, "$1"));
    const clean = decoded === null ? null : sanitizeFilename(decoded);
    if (clean) return clean;
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(header);
  if (!plain) return null;
  const raw = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2]!;
  return sanitizeFilename(raw);
}

function decodeExtValue(raw: string): string | null {
  const m = /^([^']*)'[^']*'(.*)$/.exec(raw);
  if (!m) return null;
  const charset = m[1]!.toLowerCase();
  const encoded = m[2]!;
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i]!;
    if (ch === "%") {
      const hex = encoded.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code > 0xff) return null;
      bytes.push(code);
    }
  }
  try {
    if (charset === "utf-8") return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    if (charset === "iso-8859-1") return String.fromCharCode(...bytes);
  } catch {
    return null;
  }
  return null;
}

function sanitizeFilename(raw: string): string | null {
  const last = raw.split(/[/\\]/).pop() ?? "";
  const clean = Array.from(last)
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return c > 0x1f && c !== 0x7f;
    })
    .join("")
    .trim();
  if (!clean || clean === "." || clean === "..") return null;
  return clean;
}
