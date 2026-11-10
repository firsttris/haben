import { letterheadDesignInputSchema } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  backgroundInfo,
  loadDesign,
  logoInfo,
  MAX_BACKGROUND_BYTES,
  MAX_LOGO_BYTES,
  removeBackground,
  removeLogo,
  saveAccentColor,
  saveBackground,
  saveDesign,
  saveLogo,
} from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";

export const getLogo = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => logoInfo());

export const getLetterheadDesign = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => loadDesign());

/** Das Bild kommt als Base64, wie es der Browser liest */
export const uploadLogo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ base64: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 16) }))
  .handler(async ({ data, context }) => {
    await saveLogo(context.user.id, new Uint8Array(Buffer.from(data.base64, "base64")));
    return { ok: true };
  });

export const deleteLogo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeLogo(context.user.id);
    return { ok: true };
  });

export const getBackground = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => backgroundInfo());

export const uploadBackground = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ base64: z.string().max(Math.ceil((MAX_BACKGROUND_BYTES * 4) / 3) + 16) }))
  .handler(async ({ data, context }) => {
    await saveBackground(context.user.id, new Uint8Array(Buffer.from(data.base64, "base64")));
    return { ok: true };
  });

export const deleteBackground = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await removeBackground(context.user.id);
    return { ok: true };
  });

/** Akzentfarbe des Briefkopfs; das Format prüft saveAccentColor */
export const saveAccent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ color: z.string().max(7) }))
  .handler(async ({ data, context }) => {
    await saveAccentColor(context.user.id, data.color);
    return { ok: true };
  });

/** Gestaltung aus dem Vorschau-Panel und den Einstellungen; gilt für alle Belege, die ab jetzt festgeschrieben werden */
export const saveLetterheadDesign = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(letterheadDesignInputSchema)
  .handler(async ({ data, context }) => {
    await saveDesign(context.user.id, data);
    return { ok: true };
  });
