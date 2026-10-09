import { createServerFn } from "@tanstack/react-start";
import { companyIssues, companySchema, loadCompany, updateCompany } from "../company.ts";
import { authMiddleware } from "../middleware.ts";
import { lockedChange, settingsLocks } from "../settings-guard.ts";
import { saveTaxpayer, taxpayerSchema } from "../taxpayer.ts";
import { today } from "../today.ts";
import { UserError } from "../errors.ts";

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
    const current = await loadCompany();
    const locked = lockedChange(current, data, await settingsLocks(today()));
    if (locked) throw new UserError(locked);
    await updateCompany(context.user.id, data);
    return { ok: true };
  });

export const saveTaxpayerData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taxpayerSchema)
  .handler(async ({ data, context }) => {
    await saveTaxpayer(context.user.id, data);
    return { ok: true };
  });
