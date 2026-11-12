import { env } from "../../env.ts";
import { INTERNAL_ERROR, userMessage } from "../../errors.ts";
import { today } from "../../today.ts";
import { authenticateMcp, hasScope, rateLimited, recordMcpCall, type McpAccess } from "../mcp/index.ts";
import { fail, toResponse, type ApiRequest, type ApiResult } from "./http.ts";
import { openApiDocument } from "./openapi.ts";
import { API_ROUTES, type ApiRoute } from "./routes.ts";

/*
 * Einstieg der REST-API (#199): Pfad zuordnen, Token und Recht prüfen, Rate begrenzen, Body lesen (JSON, für Belege
 * multipart/form-data), Handler aufrufen, Aufruf protokollieren. Angemeldet wird nur per Bearer-Token, nie mit der Sitzung: Ein Cookie reicht der API nicht,
 * deshalb braucht sie keinen Schutz vor Anfragen fremder Seiten (csrf.ts nimmt sie aus).
 */

export const API_PREFIX = "/api/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Größter Body; 200 Positionen mit langen Texten passen gut hinein */
const MAX_BODY_BYTES = 1_000_000;
const WITH_BODY = new Set(["POST", "PATCH"]);

/** Pfadparameter, wenn der Pfad zur Vorlage passt; {id} nur als UUID */
function matchPath(template: string, path: string): Record<string, string> | null {
  const expected = template.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    const value = actual[index]!;
    if (part.startsWith("{")) {
      if (!UUID.test(value)) return null;
      params[part.slice(1, -1)] = value.toLowerCase();
    } else if (part !== value) return null;
  }
  return params;
}

function firstValues(params: URLSearchParams): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of params) if (!(key in query)) query[key] = value;
  return query;
}

async function readJson(request: Request): Promise<{ body: unknown } | { failure: ApiResult }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/([\w.+-]+\+)?json\b/i.test(type))
    return { failure: fail("unsupported_media_type", "Body bitte als JSON mit Content-Type: application/json.") };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { failure: fail("payload_too_large", "Body ist größer als 1 MB.") };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { failure: fail("payload_too_large", "Body ist größer als 1 MB.") };
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { failure: fail("invalid_json", "Body ist kein gültiges JSON.") };
  }
}

/** Body bis höchstens `limit` Bytes, auch ohne Content-Length; null, sobald er größer ist (Rest wird nicht gelesen) */
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Felder eines Formulars als Objekt wie ein JSON-Body; ein mehrfach gesendetes Feld wird zur Liste, die das Schema ablehnt */
function formFields(form: FormData): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set(form.keys())].map((name) => {
      const values = form.getAll(name);
      return [name, values.length === 1 ? values[0] : values];
    }),
  );
}

/** multipart/form-data für Datei-Uploads, mit der Grenze des Endpunkts statt der für JSON */
async function readMultipart(request: Request, limit: number): Promise<{ body: unknown } | { failure: ApiResult }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(type)) {
    return {
      failure: fail("unsupported_media_type", "Body bitte als multipart/form-data mit der Datei im Feld datei (oder file), z. B. curl -F datei=@rechnung.pdf."),
    };
  }
  const tooLarge = () => ({ failure: fail("payload_too_large", `Body ist größer als ${Math.floor(limit / 1024 / 1024)} MB.`) });
  if (Number(request.headers.get("content-length") ?? 0) > limit) return tooLarge();
  const bytes = await readLimited(request, limit);
  if (!bytes) return tooLarge();
  try {
    return { body: formFields(await new Response(bytes, { headers: { "content-type": type } }).formData()) };
  } catch {
    return { failure: fail("invalid_multipart", "Body ist kein gültiges multipart/form-data.") };
  }
}

function readBody(route: ApiRoute, request: Request): Promise<{ body: unknown } | { failure: ApiResult }> {
  if (!WITH_BODY.has(route.method)) return Promise.resolve({ body: undefined });
  return route.multipartLimit ? readMultipart(request, route.multipartLimit) : readJson(request);
}

async function runHandler(route: ApiRoute, request: ApiRequest): Promise<ApiResult> {
  try {
    return await route.handler(request);
  } catch (error) {
    // Fachliche Ablehnung aus dem Modul oder einem Trigger: Meldung weitergeben, sonst nur ins Server-Log
    const message = userMessage(error);
    if (message !== undefined) return fail("unprocessable", message);
    console.error(error);
    return fail("internal_error", INTERNAL_ERROR);
  }
}

/**
 * Akteur im Audit-Log: api:<Token-ID>:<Name>. Der Name ist frei wählbar und nicht eindeutig (etwa nach Widerruf und
 * Neuanlage); die ID steht vorn und hat feste Länge, so bleibt der Akteur eindeutig, auch wenn der Name einen Doppelpunkt
 * enthält. Über sie führt das Audit-Log von token_events zu Anlage, Verantwortlichem und Widerruf. Ältere Einträge mit
 * api:<Name> bleiben, wie sie sind (Hash-Kette).
 */
const apiActor = (access: Pick<McpAccess, "tokenId" | "clientName">) => `api:${access.tokenId}:${access.clientName}`;

/** Ab hier ist das Token gültig: Rate, Recht, Body, Handler */
async function authorized(route: ApiRoute, access: McpAccess, params: Record<string, string>, request: Request, url: URL): Promise<ApiResult> {
  if (!hasScope(access.scopes, route.scope)) {
    return fail("forbidden", `Diesem Token fehlt das Recht „${route.scope}“. In Haben unter Einstellungen → KI-Assistenten und API ein Token damit anlegen.`);
  }
  const body = await readBody(route, request);
  if ("failure" in body) return body.failure;
  return runHandler(route, {
    actor: apiActor(access),
    params,
    query: firstValues(url.searchParams),
    body: body.body,
    baseUrl: env().BETTER_AUTH_URL.replace(/\/$/, ""),
    today: today(),
  });
}

async function dispatch(request: Request): Promise<ApiResult> {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length).replace(/\/$/, "") || "/";
  if (path === "/openapi.json" && request.method === "GET") return { status: 200, body: openApiDocument() };

  const candidates = API_ROUTES.flatMap((route) => {
    const params = matchPath(route.path, path);
    return params ? [{ route, params }] : [];
  });
  if (candidates.length === 0) return fail("not_found", `Unbekannter Endpunkt ${path}. Alle Endpunkte stehen in ${API_PREFIX}/openapi.json.`);
  const match = candidates.find((c) => c.route.method === request.method);
  if (!match) {
    return fail("method_not_allowed", `${request.method} ist hier nicht erlaubt.`, { headers: { Allow: candidates.map((c) => c.route.method).join(", ") } });
  }

  const access = await authenticateMcp(request);
  if (!access) {
    return fail(
      "unauthorized",
      "Kein gültiges API-Token. In Haben unter Einstellungen → KI-Assistenten und API anlegen und als Authorization: Bearer … senden.",
      {
        headers: { "WWW-Authenticate": 'Bearer realm="haben"' },
      },
    );
  }
  if (rateLimited(access.tokenId)) return fail("rate_limited", "Zu viele Anfragen, bitte kurz warten.", { headers: { "Retry-After": "60" } });

  const started = performance.now();
  const result = await authorized(match.route, access, match.params, request, url);
  const operation = `${match.route.method} ${match.route.path}`;
  await recordMcpCall(access, operation, result.status < 400, performance.now() - started).catch((error: unknown) => console.error(error));
  return result;
}

/** Eine Anfrage an /api/v1/… */
export async function handleApiRequest(request: Request): Promise<Response> {
  return toResponse(await dispatch(request));
}
