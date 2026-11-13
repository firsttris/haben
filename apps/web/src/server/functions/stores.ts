import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  createAllStoreDrafts,
  deleteStoreConnection,
  setStoreContact,
  storeContactSchema,
  saveStoreConnection,
  storeConnectionsSummary,
  storeContactChoices,
  storePayoutSchema,
  storeSettingsSchema,
  syncStore,
  takeOverStorePayout,
} from "../modules/stores/index.ts";

/** Abruf der Finanzberichte von Google Play und App Store (Einstellungen › Bank) */

const storeSchema = z.object({ store: z.enum(["googleplay", "appstore"]) });

export const getStoreConnections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    connections: await storeConnectionsSummary(),
    /** Kunden im Ausland, aus denen die Store-Gesellschaft für die Rechnungsentwürfe gewählt wird */
    contacts: await storeContactChoices(),
  }));

export const saveStoreConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storeSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveStoreConnection(context.user.id, data);
    return { ok: true };
  });

export const removeStoreConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storeSchema)
  .handler(async ({ data, context }) => {
    await deleteStoreConnection(context.user.id, data.store);
    return { ok: true };
  });

export const syncStoreNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storeSchema)
  .handler(async ({ data, context }) => syncStore(context.user.id, data.store));

/** Eingang von Google Play oder App Store als Auszahlung der gewählten Monate übernehmen (Bank › Umsatz) */
export const takeOverStorePayoutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storePayoutSchema)
  .handler(async ({ data, context }) => takeOverStorePayout(context.user.id, data));

export const setStoreContactFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storeContactSchema)
  .handler(async ({ data, context }) => {
    await setStoreContact(context.user.id, data);
    return { ok: true };
  });

/** Rechnungsentwürfe für alle übernommenen Monate, die noch keinen haben */
export const createStoreDraftsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(storeSchema)
  .handler(async ({ data, context }) => createAllStoreDrafts(context.user.id, data.store));
