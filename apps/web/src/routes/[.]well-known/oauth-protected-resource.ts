import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, oauthJson, protectedResourceMetadata } from "../../server/modules/mcp/index.ts";

/** Metadaten der geschützten Ressource /api/mcp (RFC 9728); darauf zeigt der WWW-Authenticate-Header einer 401 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: () => oauthJson(protectedResourceMetadata()),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
});
