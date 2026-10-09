import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, setResponseStatus } from "@tanstack/react-start/server";
import { auth } from "./auth.ts";
import { INTERNAL_ERROR, userMessage } from "./errors.ts";

class UnauthorizedError extends Error {}

/** Fehler ohne Stack und eigene Properties, denn TanStack Start serialisiert ihn vollständig an den Browser */
function clientError(message: string): Error {
  const error = new Error(message);
  delete error.stack;
  return error;
}

/**
 * Übersetzt jeden Fehler aus Validator, Handler oder Sitzungsprüfung für den Browser:
 * Fachfehler und Eingabefehler mit ihrer Meldung, alles andere nur als „Interner Fehler“ (Details ins Log).
 */
function toClientError(error: unknown): unknown {
  if (isRedirect(error) || isNotFound(error)) return error;
  if (error instanceof UnauthorizedError) {
    setResponseStatus(401);
    return clientError("Nicht angemeldet. Bitte neu anmelden.");
  }
  const message = userMessage(error);
  if (message !== undefined) return clientError(message);
  console.error(error);
  return clientError(INTERNAL_ERROR);
}

/** Jede Serverfunktion mit Daten hängt diese Middleware an. Validator und Handler laufen innerhalb von `next()`. */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const session = await auth().api.getSession({ headers: getRequestHeaders() });
    if (!session) throw new UnauthorizedError();
    return await next({ context: { user: session.user } });
  } catch (error) {
    throw toClientError(error);
  }
});
