import { LAYOUT_DOCUMENT_TYPES, layoutRefSchema } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  assignLayout,
  createLayout,
  deleteLayout,
  layoutOverview,
  MAX_LAYOUT_BYTES,
  reloadPackages,
  renameLayout,
  replaceLayoutSource,
} from "../modules/stammdaten/index.ts";

const source = z.string().max(MAX_LAYOUT_BYTES);
const name = z.string().max(80);

/** Eigene Layouts und die Hinweise für Einstellungen der Gestaltung, die ein zugeordnetes Layout nicht verwendet */
export const getLayouts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => layoutOverview());

/** Prüft und speichert ein eigenes Layout; die Prüfung setzt es mit Beispieldaten und kann einige Sekunden dauern */
export const uploadLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name, art: z.enum(["beleg", "mahnung"]), source, approve: z.array(z.string().max(200)).max(20).optional() }))
  .handler(({ data, context }) => createLayout(context.user.id, data));

export const replaceLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), source, approve: z.array(z.string().max(200)).max(20).optional() }))
  .handler(({ data, context }) => replaceLayoutSource(context.user.id, data.id, data.source, data.approve));

/** Lädt freigegebene Pakete neu, wenn der Cache fehlt; nur auf Klick */
export const reloadLayoutPackages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    await reloadPackages(data);
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
