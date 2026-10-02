import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth.ts";

export class UnauthorizedError extends Error {
  constructor() {
    super("Nicht angemeldet");
  }
}

/** Jede Serverfunktion mit Daten hängt diese Middleware an. */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await auth().api.getSession({ headers: getRequestHeaders() });
  if (!session) throw new UnauthorizedError();
  return next({ context: { user: session.user } });
});
