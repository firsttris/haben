import { createServerFn } from "@tanstack/react-start";
import { datevNumbersSchema, saveDatevNumbers } from "../modules/auswertungen/index.ts";
import { authMiddleware } from "../middleware.ts";

export const saveDatevNumbersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(datevNumbersSchema)
  .handler(async ({ data, context }) => {
    await saveDatevNumbers(context.user.id, data);
    return { ok: true };
  });
