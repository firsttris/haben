import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "../../server/modules/mcp/index.ts";

/**
 * MCP-Endpunkt für KI-Assistenten (Streamable HTTP, zustandslos). Clients melden sich mit einem API-Token als
 * Bearer-Header an, nicht mit der Sitzung; ohne eingeschalteten Zugang antwortet er mit 401.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpRequest(request),
      GET: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
});
