import type { createCsrfMiddleware } from "@tanstack/react-start";
import { env } from "./env.ts";

type CsrfOptions = NonNullable<Parameters<typeof createCsrfMiddleware>[0]>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Prüfen selbst: MCP per Bearer-Token ohne Browser, OAuth-Registrierung und Token ohne Sitzungscookie, das Teilen-Ziel lässt auch das Teilen-Menü des Systems zu */
const OWN_CHECK = new Set(["/api/mcp", "/api/belege/teilen", "/api/oauth/register", "/api/oauth/token"]);
/** REST-API: meldet sich nur mit Bearer-Token an, nie mit dem Sitzungscookie; eine fremde Seite erbt also keine Rechte */
const API_PREFIX = "/api/v1/";

/**
 * Schreibende Anfragen nur von der eigenen Seite: Sec-Fetch-Site, sonst Origin oder Referer müssen
 * passen. Ergänzt SameSite=Lax des Sitzungscookies, auch für Instanzen auf Nachbar-Subdomains.
 * Ohne alle drei Header (kein Browser) entscheidet allein die Anmeldung.
 */
export const csrfOptions: CsrfOptions = {
  filter: ({ request, pathname }) => !SAFE_METHODS.has(request.method) && !OWN_CHECK.has(pathname) && !pathname.startsWith(API_PREFIX),
  origin: (origin) => origin === new URL(env().BETTER_AUTH_URL).origin,
  allowRequestsWithoutOriginCheck: true,
  failureResponse: () => new Response("Anfrage von fremder Seite abgelehnt", { status: 403 }),
};
