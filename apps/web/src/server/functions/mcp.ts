import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createMcpToken, listMcpTokens, MCP_TOOLS, mcpEnabled, mcpTokenInputSchema, recentMcpCalls, revokeMcpToken, setMcpEnabled } from "../modules/mcp/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Einstellungen → KI-Assistenten: Schalter, Zugänge, letzte Aufrufe und die angebotenen Werkzeuge */
export const getMcpSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [enabled, tokens, calls] = await Promise.all([mcpEnabled(), listMcpTokens(), recentMcpCalls()]);
    return { enabled, tokens, calls, tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title })) };
  });

export const setMcpEnabledFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setMcpEnabled(context.user.id, data.enabled);
    return { ok: true };
  });

/** Neues API-Token; der Klartext kommt nur in dieser Antwort vor */
export const createMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(mcpTokenInputSchema)
  .handler(({ data }) => createMcpToken(data));

export const revokeMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await revokeMcpToken(data.id);
    return { ok: true };
  });
