import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createCustomPage, customPageInputSchema, deleteCustomPage, getCustomPage, listCustomPages, updateCustomPage } from "../modules/eigene-seiten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { detailId } from "./schemas.ts";

/** Alle eigenen Seiten für die Einstellungen */
export const getCustomPages = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listCustomPages());

/** Eine Seite zum Anzeigen; null, wenn es sie nicht (mehr) gibt */
export const getCustomPageFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(({ id }: { id: string }) => ({ id: detailId(id) }))
  .handler(async ({ data }) => {
    const page = await getCustomPage(data.id);
    return page && { id: page.id, name: page.name, url: page.url };
  });

export const saveCustomPage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), page: customPageInputSchema }))
  .handler(async ({ data, context }) => {
    const row = data.id ? await updateCustomPage(context.user.id, data.id, data.page) : await createCustomPage(context.user.id, data.page);
    return { id: row.id };
  });

export const deleteCustomPageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await deleteCustomPage(context.user.id, data.id);
    return { ok: true };
  });
