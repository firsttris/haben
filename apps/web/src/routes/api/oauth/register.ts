import { createFileRoute } from "@tanstack/react-router";
import { handleRegister, handlePreflight } from "../../../server/modules/mcp/index.ts";

/** Dynamic Client Registration (RFC 7591) ohne Anmeldung; Zugriff gibt erst die Zustimmung des Inhabers */
export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      POST: ({ request }) => handleRegister(request),
      OPTIONS: () => handlePreflight(),
    },
  },
});
