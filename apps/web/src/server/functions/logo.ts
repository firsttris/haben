import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LogoError, logoInfo, MAX_LOGO_BYTES, removeLogo, saveLogo } from "../logo.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof LogoError) throw new Error(error.message);
  throw error;
}

export const getLogo = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => logoInfo());

/** Das Bild kommt als Base64, wie es der Browser liest */
export const uploadLogo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ base64: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 16) }))
  .handler(async ({ data, context }) => {
    await saveLogo(context.user.id, new Uint8Array(Buffer.from(data.base64, "base64"))).catch(asUserError);
    return { ok: true };
  });

export const deleteLogo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeLogo(context.user.id);
    return { ok: true };
  });
