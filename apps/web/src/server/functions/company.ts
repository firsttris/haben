import { createServerFn } from "@tanstack/react-start";
import { companyIssues, companySchema, loadCompany } from "../company.ts";
import { withActor } from "../db/actor.ts";
import { schema } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";
import { lockedChange, settingsLocks } from "../settings-guard.ts";
import { saveTaxpayer, taxpayerSchema } from "../taxpayer.ts";
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
    const current = await loadCompany();
    const locked = lockedChange(current, data, await settingsLocks(today()));
    if (locked) throw new Error(locked);
    await withActor(context.user.id, (tx) =>
      tx.update(schema.company).set({ ...data, updatedAt: new Date() }),
    );
    return { ok: true };
  });

export const saveTaxpayerData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taxpayerSchema)
  .handler(async ({ data, context }) => {
    await saveTaxpayer(context.user.id, data);
    return { ok: true };
  });
