import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { deleteStripeConnection, saveStripeConnection, stripeSettingsSchema, stripeSummary, syncStripe } from "../modules/stripe/index.ts";

/** Balance Transactions von Stripe (Einstellungen › Bank) */

export const getStripeSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => stripeSummary());

export const saveStripeConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(stripeSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveStripeConnection(context.user.id, data);
    return { ok: true };
  });

export const removeStripeConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteStripeConnection(context.user.id);
    return { ok: true };
  });

export const syncStripeNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => syncStripe(context.user.id));
