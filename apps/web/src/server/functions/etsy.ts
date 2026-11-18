import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import {
  deleteEtsyConnection,
  disconnectEtsyConnection,
  etsySettingsSchema,
  etsySummary,
  saveEtsyConnection,
  startEtsyConnection,
  syncEtsy,
} from "../modules/etsy/index.ts";

/** Zahlungsverlauf von Etsy Payments (Einstellungen › Bank) */

export const getEtsySettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => etsySummary());

export const saveEtsyConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(etsySettingsSchema)
  .handler(async ({ data, context }) => {
    await saveEtsyConnection(context.user.id, data);
    return { ok: true };
  });

/** Erste Adresse des Ablaufs: der Browser geht damit zu Etsy */
export const connectEtsyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ url: await startEtsyConnection(context.user.id) }));

export const disconnectEtsyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await disconnectEtsyConnection(context.user.id);
    return { ok: true };
  });

export const removeEtsyConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteEtsyConnection(context.user.id);
    return { ok: true };
  });

export const syncEtsyNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => syncEtsy(context.user.id));
