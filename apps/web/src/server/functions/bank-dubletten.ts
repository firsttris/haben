import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { decideDuplicate, duplicateDecisionSchema } from "../modules/bank/index.ts";

export const decideBankDuplicate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(duplicateDecisionSchema)
  .handler(async ({ data, context }) => {
    await decideDuplicate(context.user.id, data);
    return { ok: true };
  });
