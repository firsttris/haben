import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { addExternalSource, boundAccountIds, externalSources, externalSourceSchema } from "../modules/bank/index.ts";

/* Externe Quellen für den REST-Import (#306, Schritt 4): am Konto freigeben und mit Stand und Konflikten auflisten. */

export const getExternalBankSources = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ quellen: await externalSources(), gebundeneKonten: await boundAccountIds() }));

/** Erst nach der Freigabe nimmt der REST-Import Lieferungen für diese Quelle an */
export const addExternalBankSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(externalSourceSchema)
  .handler(async ({ data, context }) => {
    await addExternalSource(context.user.id, data);
    return { ok: true };
  });
