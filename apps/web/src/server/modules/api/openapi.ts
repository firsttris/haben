import { z } from "zod";
import { TOKEN_SCOPE_LABELS, TOKEN_SCOPES } from "../mcp/index.ts";
import { API_ROUTES, type ApiRoute } from "./routes.ts";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { DOCUMENT_MEDIA_TYPES, requestSchemas, responseSchemas } from "./schemas.ts";

/*
 * OpenAPI-3.1-Beschreibung von /api/v1, erzeugt aus der Tabelle der Endpunkte (routes.ts) und den Zod-Schemas
 * (schemas.ts) mit z.toJSONSchema aus Zod 4; JSON Schema 2020-12 ist das Schema-Format von OpenAPI 3.1. Von Hand
 * gepflegt ist hier nur der Rahmen.
 */

type JsonSchema = Record<string, unknown>;

const DOCS = "https://haben.app/api.html";
const REF = (id: string) => `#/components/schemas/${id}`;
const MAX_DOCUMENT_MB = MAX_DOCUMENT_SIZE / 1024 / 1024;

const DESCRIPTION = [
  "Allgemeine Schnittstelle von Haben für eigene Werkzeuge und Automationen. Sie liest und schreibt Kontakte und",
  "Rechnungsentwürfe und nimmt Eingangsbelege an, die in Haben als „Zu prüfen“ landen. Sie bucht nichts, schreibt nichts",
  "fest und versendet nichts: Das bleibt wegen GoBD ein Klick in Haben.",
  "",
  "Anmeldung mit einem API-Token aus Einstellungen → KI-Assistenten und API als `Authorization: Bearer hb_…`. Jeder",
  "Endpunkt verlangt ein Recht (scope); schreiben schließt lesen ein.",
  "",
  "Geld in ganzen Cent (5712 = 57,12 €), Steuersätze in Basispunkten (1900 = 19 %), Mengen in Tausendsteln (1 Stück = 1000),",
  "Datumsangaben JJJJ-MM-TT. Fehler kommen immer als `{ error: { code, message, issues? } }` mit deutscher Meldung.",
  `Beispiele und Einrichtung: ${DOCS}`,
].join("\n");

/** Ohne $schema und $id: In components gilt der Dialekt von OpenAPI 3.1, die Namen stehen schon als Schlüssel */
function withoutDialect({ $schema: _schema, $id: _id, ...schema }: JsonSchema): JsonSchema {
  return schema;
}

/** Datei in multipart/form-data nach OpenAPI 3.1: ein String mit Medientyp statt format: binary aus OpenAPI 3.0 */
function fileAsBinary({ zodSchema, jsonSchema }: { zodSchema: unknown; jsonSchema: JsonSchema }) {
  if ((zodSchema as { _zod: { def: { type: string } } })._zod.def.type !== "file") return;
  delete jsonSchema.format;
  delete jsonSchema.contentEncoding;
  jsonSchema.contentMediaType = "application/octet-stream";
}

function registrySchemas(registry: typeof requestSchemas, io: "input" | "output"): Record<string, JsonSchema> {
  const { schemas } = z.toJSONSchema(registry, { target: "draft-2020-12", io, uri: REF, unrepresentable: "any", override: fileAsBinary });
  return Object.fromEntries(Object.entries(schemas).map(([id, schema]) => [id, withoutDialect(schema as JsonSchema)]));
}

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: REF("Error") } } } });

/** Fehler, die bei diesem Endpunkt vorkommen können */
function errorResponses(route: ApiRoute): Record<string, unknown> {
  const withBody = route.requestBody !== undefined;
  const multipart = route.multipartLimit !== undefined;
  const bodyErrors = multipart
    ? {
        413: errorResponse(`Datei größer als ${MAX_DOCUMENT_MB} MB`),
        415: errorResponse("Body nicht als multipart/form-data, oder die Datei ist kein PDF, Bild oder E-Rechnungs-XML"),
      }
    : { 413: errorResponse("Body größer als 1 MB"), 415: errorResponse("Body nicht als application/json") };
  const invalid = multipart ? "kein gültiges multipart/form-data (invalid_multipart)" : "kein JSON (invalid_json)";
  return {
    ...(withBody || route.query ? { 400: errorResponse(`Ungültige Eingabe (validation_failed) oder ${invalid}`) } : {}),
    401: errorResponse("Kein gültiges Token, oder der Zugang ist in Haben ausgeschaltet"),
    403: errorResponse(`Dem Token fehlt das Recht ${route.scope}`),
    ...(route.path.includes("{id}") ? { 404: errorResponse("Nicht gefunden") } : {}),
    ...Object.fromEntries(Object.entries(route.errors ?? {}).map(([status, description]) => [status, errorResponse(description)])),
    ...(withBody ? bodyErrors : {}),
    ...(route.method !== "GET" ? { 422: errorResponse("Fachlich abgelehnt, z. B. unbekannter Kontakt") } : {}),
    429: errorResponse("Mehr als 120 Anfragen je Minute und Token"),
    500: errorResponse("Interner Fehler, Details im Server-Log"),
  };
}

function parameters(route: ApiRoute) {
  const path = route.path.includes("{id}") ? [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }] : [];
  const query = Object.entries(route.query?.shape ?? {}).map(([name, field]) => {
    const schema = withoutDialect(z.toJSONSchema(field as z.ZodType, { target: "draft-2020-12", io: "output", unrepresentable: "any" }) as JsonSchema);
    const { description, ...rest } = schema;
    return { name, in: "query", required: false, ...(description ? { description } : {}), schema: rest };
  });
  return [...path, ...query];
}

function requestBody(route: ApiRoute, schema: string) {
  if (!route.multipartLimit) return { required: true, content: { "application/json": { schema: { $ref: REF(schema) } } } };
  // Welche Dateien Haben annimmt; erkannt wird am Inhalt, der angegebene Typ ist nur ein Hinweis
  const contentType = DOCUMENT_MEDIA_TYPES.join(", ");
  const encoding = { datei: { contentType }, file: { contentType } };
  return { required: true, content: { "multipart/form-data": { schema: { $ref: REF(schema) }, encoding } } };
}

function operation(route: ApiRoute) {
  const responses = Object.fromEntries(
    Object.entries(route.responses).map(([status, { schema, description }]) => [
      status,
      schema ? { description, content: { "application/json": { schema: { $ref: REF(schema) } } } } : { description },
    ]),
  );
  return {
    operationId: `${route.method.toLowerCase()}${route.path.replace(/\{id\}/g, "Id").replace(/\/(\w)/g, (_, c: string) => c.toUpperCase())}`,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    tags: [route.tag],
    security: [{ token: [route.scope] }],
    parameters: parameters(route),
    ...(route.requestBody ? { requestBody: requestBody(route, route.requestBody) } : {}),
    responses: { ...responses, ...errorResponses(route) },
  };
}

function buildDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) paths[route.path] = { ...paths[route.path], [route.method.toLowerCase()]: operation(route) };
  return {
    openapi: "3.1.0",
    info: { title: "Haben REST-API", version: "1.0.0", description: DESCRIPTION, license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" } },
    externalDocs: { description: "Dokumentation", url: DOCS },
    servers: [{ url: "/api/v1" }],
    tags: [
      { name: "Kontakte", description: "Kunden; versioniert, nicht löschbar" },
      { name: "Rechnungen", description: "Alle Rechnungen lesen, Entwürfe anlegen, ändern und löschen" },
      { name: "Belege", description: "Eingangsbelege hochladen und ihren Stand lesen; geprüft und gebucht wird in Haben" },
    ],
    paths,
    components: {
      schemas: { ...registrySchemas(requestSchemas, "input"), ...registrySchemas(responseSchemas, "output") },
      securitySchemes: {
        token: {
          type: "http",
          scheme: "bearer",
          description: `API-Token aus Haben (hb_…). Rechte: ${TOKEN_SCOPES.filter((s) => s !== "haben:lesen")
            .map((s) => `${s} (${TOKEN_SCOPE_LABELS[s]})`)
            .join(", ")}.`,
        },
      },
    },
  };
}

let cached: ReturnType<typeof buildDocument> | null = null;

/** Die Beschreibung ändert sich nur mit dem Code; einmal je Prozess erzeugt */
export function openApiDocument() {
  cached ??= buildDocument();
  return cached;
}
