import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { deletePayPalConnection, paypalSettingsSchema, paypalSummary, savePayPalConnection, syncPayPal } from "../modules/paypal/index.ts";

/** Transaction Search von PayPal (Einstellungen › Bank) */

export const getPayPalSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => paypalSummary());

export const savePayPalConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(paypalSettingsSchema)
  .handler(async ({ data, context }) => {
    await savePayPalConnection(context.user.id, data);
    return { ok: true };
  });

export const removePayPalConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deletePayPalConnection(context.user.id);
    return { ok: true };
  });

export const syncPayPalNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => syncPayPal(context.user.id));
