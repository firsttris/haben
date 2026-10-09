import { createServerFn } from "@tanstack/react-start";
import { loadCompany } from "../company.ts";
import { datevNumbersSchema, saveDatevNumbers } from "../datev-export.ts";
import { authMiddleware } from "../middleware.ts";

export const getDatevNumbers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const company = await loadCompany();
    return { beraterNr: company.datevBeraterNr, mandantNr: company.datevMandantNr, kontenrahmen: company.kontenrahmen };
  });

export const saveDatevNumbersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(datevNumbersSchema)
  .handler(async ({ data, context }) => {
    await saveDatevNumbers(context.user.id, data);
    return { ok: true };
  });
