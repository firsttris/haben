import { createFileRoute } from "@tanstack/react-router";
import { authorizationServerMetadata, CORS_HEADERS, oauthJson } from "../../server/modules/mcp/index.ts";

/** Metadaten des Autorisierungsservers (RFC 8414) für die Connectors in claude.ai */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: () => oauthJson(authorizationServerMetadata()),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
});
