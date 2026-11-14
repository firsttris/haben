import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, handleRegister } from "../../../server/modules/mcp/index.ts";

/** Dynamic Client Registration (RFC 7591) ohne Anmeldung; Zugriff gibt erst die Zustimmung des Inhabers */
export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      POST: ({ request }) => handleRegister(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
});
