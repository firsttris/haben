import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkAuthorizeRequest, decideAuthorization, mcpEnabled } from "../modules/mcp/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Parameter der Autorisierungsanfrage (RFC 6749 4.1.1, PKCE, RFC 8707), wie sie in der Adresse der Zustimmungsseite stehen */
export const authorizeParamsSchema = z.object({
  response_type: z.string().max(50).optional(),
  client_id: z.string().max(200).optional(),
  redirect_uri: z.string().max(500).optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(500).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  resource: z.string().max(500).optional(),
});

/** Zustimmungsseite: wer fragt, wohin es danach geht und ob der Zugang eingeschaltet ist; nur der Inhaber */
export const getOAuthConsent = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(authorizeParamsSchema)
  .handler(async ({ data }) => {
    const check = await checkAuthorizeRequest(data);
    if (check.kind !== "ok") return check;
    return { kind: "ok" as const, clientName: check.client.name, redirectHost: new URL(check.redirectUri).host, enabled: await mcpEnabled() };
  });

/** Zustimmen oder ablehnen; die Antwort ist die Adresse, zu der der Browser zurück zum Client geht */
export const decideOAuthConsent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(authorizeParamsSchema.extend({ approve: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { approve, ...params } = data;
    return { url: await decideAuthorization(params, context.user.id, approve) };
  });
