import { createFileRoute } from "@tanstack/react-router";
import { handleToken, handlePreflight } from "../../../server/modules/mcp/index.ts";

/** Token-Endpunkt (Code gegen Tokens, Refresh mit Rotation); der Client meldet sich selbst an, ohne Sitzungscookie */
export const Route = createFileRoute("/api/oauth/token")({
  server: {
    handlers: {
      POST: ({ request }) => handleToken(request),
      OPTIONS: () => handlePreflight(),
    },
  },
});
