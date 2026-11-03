import { createFileRoute } from "@tanstack/react-router";
import { handleApiRequest } from "../../../server/modules/api/index.ts";

/**
 * REST-API, Version 1: alle Pfade unter /api/v1 gehen an handleApiRequest, das selbst verteilt (Tabelle der Endpunkte
 * in server/modules/api/routes.ts). Anmeldung mit API-Token als Bearer-Header, nicht mit der Sitzung.
 */
export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      POST: ({ request }) => handleApiRequest(request),
      PATCH: ({ request }) => handleApiRequest(request),
      PUT: ({ request }) => handleApiRequest(request),
      DELETE: ({ request }) => handleApiRequest(request),
    },
  },
});
