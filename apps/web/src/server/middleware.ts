import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, setResponseStatus } from "@tanstack/react-start/server";
import { ReadOnlyError, runReadOnly } from "./db/actor.ts";
import { INTERNAL_ERROR, userMessage } from "./errors.ts";
import { darf, sessionUser, type Zugriff } from "./rollen.ts";

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

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
  if (error instanceof ForbiddenError || error instanceof ReadOnlyError) {
    setResponseStatus(403);
    return clientError("Das darf nur der Inhaber. Die Steuerberatung hat nur Lesezugriff.");
  }
  const message = userMessage(error);
  if (message !== undefined) return clientError(message);
  console.error(error);
  return clientError(INTERNAL_ERROR);
}

/**
 * Sitzung und Rolle prüfen, dann den Handler ausführen. Ohne Inhaber-Rolle läuft er in `runReadOnly`: Jede Transaktion
 * mit Audit-Akteur wird dann abgelehnt, auch wenn eine lesende Funktion aus Versehen etwas schreibt.
 */
function withAccess(zugriff: Zugriff) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    try {
      const user = await sessionUser(getRequestHeaders());
      if (!user) throw new UnauthorizedError();
      if (!darf(user.role, zugriff)) throw new ForbiddenError();
      const run = () => next({ context: { user } });
      return await (user.role === "inhaber" ? run() : runReadOnly(run));
    } catch (error) {
      throw toClientError(error);
    }
  });
}

/**
 * Vorgabe für jede Serverfunktion mit Daten: nur der Inhaber. Validator und Handler laufen innerhalb von `next()`.
 * Was die Steuerberatung auch sehen darf, nimmt stattdessen `readMiddleware`.
 */
export const authMiddleware = withAccess("inhaber");

/**
 * Nur für lesende GET-Funktionen, die die Steuerberatung braucht (Auswertungen, Journal, Konten, Belege, Rechnungen,
 * Export). `rollen.test.ts` prüft, dass sie nur an GET hängt, und führt die Liste dieser Funktionen.
 */
export const readMiddleware = withAccess("lesen");
