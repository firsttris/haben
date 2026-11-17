import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { csrfOptions } from "./server/csrf.ts";
import { withFrameAncestors } from "./server/security-headers.ts";

/** Läuft für jede Anfrage, Seiten wie API */
const securityHeaders = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  return { ...result, response: withFrameAncestors(result.response, new URL(request.url).pathname) };
});

/**
 * Fehler mit den Feldern eines Fachfehlers (`clientError` in server/middleware.ts) samt `felder` zum Browser: Ohne diesen
 * Adapter überträgt TanStack Start von einem Fehler nur die Meldung
 */
const feldfehler = createSerializationAdapter({
  key: "haben/feldfehler",
  test: (value): value is Error & { felder: string[] } => value instanceof Error && Array.isArray((value as { felder?: unknown }).felder),
  toSerializable: (error) => ({ message: error.message, felder: error.felder }),
  fromSerializable: ({ message, felder }) => Object.assign(new Error(message), { felder }),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [createCsrfMiddleware(csrfOptions), securityHeaders],
  serializationAdapters: [feldfehler],
}));
