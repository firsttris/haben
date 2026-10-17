import { createServerFn } from "@tanstack/react-start";
import { companyIssues, companySchema, loadCompany } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { saveCompany as saveCompanySettings, settingsLocks } from "../modules/stammdaten/index.ts";
import { saveTaxpayer, taxpayerSchema } from "../modules/stammdaten/index.ts";
import { today } from "../today.ts";

export const getCompany = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const company = await loadCompany();
    return { company, issues: companyIssues(company), locks: await settingsLocks(today()) };
  });

export const saveCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(companySchema)
  .handler(async ({ data, context }) => {
    await saveCompanySettings(context.user.id, data, today());
    return { ok: true };
  });

export const saveTaxpayerData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taxpayerSchema)
  .handler(async ({ data, context }) => {
    await saveTaxpayer(context.user.id, data);
    return { ok: true };
  });
