import { createFileRoute } from "@tanstack/react-router";
import { handleMetadata, handlePreflight } from "../../server/modules/mcp/index.ts";

/** Metadaten des Autorisierungsservers (RFC 8414) für die Connectors in claude.ai */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: () => handleMetadata("server"),
      OPTIONS: () => handlePreflight(),
    },
  },
});
