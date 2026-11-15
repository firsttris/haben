import { createFileRoute } from "@tanstack/react-router";
import { handleMetadata, handlePreflight } from "../../server/modules/mcp/index.ts";

/**
 * Dieselben Metadaten unter dem Pfad der Ressource (RFC 9728, 3.1: /.well-known/oauth-protected-resource/api/mcp). Der Router
 * gibt auch /.well-known/oauth-protected-resource selbst hierher, mit leerem Rest.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      GET: ({ params }) => handleMetadata("resource", params._splat ?? ""),
      OPTIONS: () => handlePreflight(),
    },
  },
});
