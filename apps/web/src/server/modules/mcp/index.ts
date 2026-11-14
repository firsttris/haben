/*
 * Zugang für KI-Assistenten über MCP (#96): Endpunkt /api/mcp, API-Tokens, Protokoll der Werkzeugaufrufe und die
 * Werkzeuge selbst. Nur lesen; lokale Clients mit API-Token, Connectors (claude.ai) per OAuth (oauth.ts). Dieselben Tokens melden sich mit eigenen
 * Rechten an der REST-API an (modules/api, #199).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { handleMcpRequest, rateLimited } from "./server.ts";
export {
  authenticateMcp,
  createMcpToken,
  hasScope,
  listMcpTokens,
  mcpEnabled,
  McpError,
  mcpTokenInputSchema,
  recentMcpCalls,
  recordMcpCall,
  revokeMcpToken,
  reactivateMcpToken,
  setMcpEnabled,
  TOKEN_SCOPE_LABELS,
  TOKEN_SCOPES,
  type McpAccess,
  type TokenScope,
} from "./tokens.ts";
export { MCP_TOOLS } from "./tools.ts";
export {
  authorizationServerMetadata,
  checkAuthorizeRequest,
  CORS_HEADERS,
  decideAuthorization,
  handleRegister,
  handleToken,
  json as oauthJson,
  protectedResourceMetadata,
  resetOAuthStateForTests,
  type AuthorizeParams,
} from "./oauth.ts";
