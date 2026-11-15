import { ASSET_KIND_KEYS } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { previewSevdeskAssets, takeOverSevdeskAssets } from "../modules/archiv/index.ts";

const stichtagSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Anlagenverzeichnis aus sevDesk als Vorschlag zum Stichtag (01.01.); liest sevDesk, speichert nichts */
export const getSevdeskAssets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ stichtag: stichtagSchema }))
  .handler(async ({ data }) => previewSevdeskAssets(data.stichtag));

export const takeOverSevdeskAssetList = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      stichtag: stichtagSchema,
      picks: z
        .array(z.object({ sevId: z.string().min(1).max(40), kind: z.enum(ASSET_KIND_KEYS).nullable() }))
        .min(1)
        .max(2000),
    }),
  )
  .handler(async ({ data, context }) => takeOverSevdeskAssets(context.user.id, data.stichtag, data.picks));
