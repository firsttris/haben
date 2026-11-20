import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { BESTAETIGEN_HOECHSTENS } from "../../lib/bestaetigen-grenze.ts";
import { bestaetigeVorschlaege } from "../modules/bank/index.ts";

/** Vorschläge der Bankliste bestätigen: ein Umsatz oder alle markierten, alles oder nichts (#1440) */
export const confirmProposalsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ transactionIds: z.array(z.uuid()).min(1).max(BESTAETIGEN_HOECHSTENS) }))
  .handler(async ({ data, context }) => {
    await bestaetigeVorschlaege(context.user.id, data.transactionIds);
    return { ok: true, count: new Set(data.transactionIds).size };
  });
