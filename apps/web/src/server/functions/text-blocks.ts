import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createTextBlock,
  listContactChoices,
  listTextBlocks,
  setTextBlockArchived,
  textBlockInputSchema,
  updateTextBlock,
} from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Alle Bausteine samt archivierten, mit den Kunden für die Zuordnung */
export const getTextBlocks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [blocks, contacts] = await Promise.all([listTextBlocks({ archived: true }), listContactChoices("kunde")]);
    return { blocks, contacts };
  });

export const saveTextBlock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), block: textBlockInputSchema }))
  .handler(async ({ data, context }) => {
    const row = data.id ? await updateTextBlock(context.user.id, data.id, data.block) : await createTextBlock(context.user.id, data.block);
    return { id: row.id };
  });

export const archiveTextBlock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setTextBlockArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });
