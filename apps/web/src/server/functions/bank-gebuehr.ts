import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { allocatePaymentWithFee, zahlungMitGebuehrSchema } from "../modules/bank/index.ts";

/** Zahlung eines Zahlungsdienstleisters samt der Gebühr derselben Bewegung in einem Schritt zuordnen (#1417) */
export const allocatePaymentAndFee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(zahlungMitGebuehrSchema)
  .handler(async ({ data, context }) => {
    await allocatePaymentWithFee(context.user.id, data);
    return { ok: true };
  });
