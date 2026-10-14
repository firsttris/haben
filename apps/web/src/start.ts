import { createMiddleware, createStart } from "@tanstack/react-start";
import { withFrameAncestors } from "./server/security-headers.ts";

/** Läuft für jede Anfrage, Seiten wie API */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next();
  return { ...result, response: withFrameAncestors(result.response) };
});

export const startInstance = createStart(() => ({ requestMiddleware: [securityHeaders] }));
