/*
 * Zugang für KI-Assistenten über MCP (#96): Endpunkt /api/mcp, API-Tokens, Protokoll der Werkzeugaufrufe und die
 * Werkzeuge selbst. Stufe 1: nur lesen, für lokale Clients mit API-Token.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Lint-Regel haben/modulgrenzen, eslint/modulgrenzen.js).
 */
export { handleMcpRequest } from "./server.ts";
export {
  createMcpToken,
  listMcpTokens,
  MCP_TOKEN_DAYS,
  mcpEnabled,
  McpError,
  mcpTokenInputSchema,
  recentMcpCalls,
  revokeMcpToken,
  setMcpEnabled,
} from "./tokens.ts";
export { MCP_TOOLS } from "./tools.ts";
