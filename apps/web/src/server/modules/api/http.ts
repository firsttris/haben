import type { z } from "zod";
import { de } from "zod/locales";
import type { ErrorCode } from "./schemas.ts";

/*
 * Antworten der REST-API als Daten: Handler geben ein ApiResult zurück, erst router.ts macht daraus eine Response. Fehler
 * haben immer dieselbe Form { error: { code, message, issues? } } mit deutscher Meldung (errorSchema).
 */

export interface ApiResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Issue {
  path: string;
  message: string;
}

/** Was ein Handler von der Anfrage sieht; Anmeldung und Recht sind schon geprüft */
export interface ApiRequest {
  /** Akteur im Audit-Log: api:<Name des Tokens> */
  actor: string;
  /** Pfadparameter, z. B. id */
  params: Record<string, string>;
  /** Query-Parameter als Objekt, je Name der erste Wert */
  query: Record<string, string>;
  /** Geparster JSON-Body bei POST und PATCH */
  body: unknown;
  /** Adresse von Haben ohne Schrägstrich am Ende, für Links in den Antworten */
  baseUrl: string;
  /** Heutiges Datum in Deutschland, JJJJ-MM-TT */
  today: string;
}

export type Handler = (request: ApiRequest) => Promise<ApiResult>;

export const ok = (body: unknown, status = 200, headers: Record<string, string> = {}): ApiResult => ({ status, body, headers });

export const noContent = (): ApiResult => ({ status: 204 });

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  invalid_json: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  validation_failed: 400,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal_error: 500,
};

export function fail(code: ErrorCode, message: string, extra: { issues?: Issue[]; headers?: Record<string, string> } = {}): ApiResult {
  return { status: STATUS[code], body: { error: { code, message, ...(extra.issues ? { issues: extra.issues } : {}) } }, headers: extra.headers };
}

export const notFound = (message: string) => fail("not_found", message);

/** Zod-Fehler als Liste je Feld, die Meldungen wie in der Oberfläche */
export function validationFailed(error: z.ZodError): ApiResult {
  const issues = error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
  const summary = [...new Set(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)))].join("; ");
  return fail("validation_failed", `Ungültige Eingabe. ${summary}`, { issues });
}

/** Meldungen von Zod auf Deutsch, wo ein Schema keine eigene hat (etwa „Ungültige Option: erwartet eine von 1900|700|0“) */
const { localeError } = de();

/** Ergebnis von safeParse als Daten oder fertige Fehlerantwort */
export function validate<T extends z.ZodType>(schema: T, value: unknown): { data: z.output<T> } | { failure: ApiResult } {
  const parsed = schema.safeParse(value, { error: localeError });
  return parsed.success ? { data: parsed.data } : { failure: validationFailed(parsed.error) };
}

export function toResponse(result: ApiResult): Response {
  const headers = {
    "Cache-Control": "no-store",
    ...(result.body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    ...result.headers,
  };
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status, headers });
}
