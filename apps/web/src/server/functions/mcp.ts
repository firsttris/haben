import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createMcpToken,
  listMcpTokens,
  MCP_TOOLS,
  mcpEnabled,
  mcpTokenInputSchema,
  recentMcpCalls,
  revokeMcpToken,
  reactivateMcpToken,
  setMcpEnabled,
  TOKEN_SCOPE_LABELS,
  TOKEN_SCOPES,
} from "../modules/mcp/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Einstellungen → KI-Assistenten und API: Schalter, Zugänge, letzte Aufrufe, die angebotenen Werkzeuge und die Rechte */
export const getMcpSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [enabled, tokens, calls] = await Promise.all([mcpEnabled(), listMcpTokens(), recentMcpCalls()]);
    return {
      enabled,
      actorId: context.user.id,
      tokens,
      calls,
      tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title })),
      scopes: TOKEN_SCOPES.map((id) => ({ id, label: TOKEN_SCOPE_LABELS[id] })),
    };
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
  .handler(({ data, context }) => createMcpToken(data, new Date(), context.user.id));

export const revokeMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await revokeMcpToken(data.id);
    return { ok: true };
  });

export const reactivateMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await reactivateMcpToken(context.user.id, data.id);
    return { ok: true };
  });
