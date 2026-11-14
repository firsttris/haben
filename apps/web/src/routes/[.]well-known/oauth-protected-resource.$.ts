import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, oauthJson, protectedResourceMetadata } from "../../server/modules/mcp/index.ts";

/**
 * Dieselben Metadaten unter dem Pfad der Ressource (RFC 9728, 3.1: /.well-known/oauth-protected-resource/api/mcp). Der Router
 * gibt auch /.well-known/oauth-protected-resource selbst hierher, mit leerem Rest.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      GET: ({ params }) =>
        !params._splat || params._splat === "api/mcp" ? oauthJson(protectedResourceMetadata()) : new Response("Nicht gefunden", { status: 404 }),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
});
