import { LAYOUT_DOCUMENT_TYPES, layoutRefSchema } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { assignLayout, createLayout, deleteLayout, listLayouts, MAX_LAYOUT_BYTES, renameLayout, replaceLayoutSource } from "../modules/stammdaten/index.ts";

const source = z.string().max(MAX_LAYOUT_BYTES);
const name = z.string().max(80);

export const getLayouts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listLayouts());

/** Prüft und speichert ein eigenes Layout; die Prüfung setzt es mit Beispieldaten und kann einige Sekunden dauern */
export const uploadLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name, art: z.enum(["beleg", "mahnung"]), source }))
  .handler(({ data, context }) => createLayout(context.user.id, data));

export const replaceLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), source }))
  .handler(async ({ data, context }) => {
    await replaceLayoutSource(context.user.id, data.id, data.source);
    return { ok: true };
  });

export const renameLayoutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), name }))
  .handler(async ({ data, context }) => {
    await renameLayout(context.user.id, data.id, data.name);
    return { ok: true };
  });

export const removeLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteLayout(context.user.id, data);
    return { ok: true };
  });

export const assignLayoutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ type: z.enum(LAYOUT_DOCUMENT_TYPES), ref: layoutRefSchema }))
  .handler(async ({ data, context }) => {
    await assignLayout(context.user.id, data.type, data.ref);
    return { ok: true };
  });
