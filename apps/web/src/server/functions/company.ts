import { createServerFn } from "@tanstack/react-start";
import { companyIssues, companySchema, loadCompany } from "../company.ts";
import { withActor } from "../db/actor.ts";
import { schema } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";

export const getCompany = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const company = await loadCompany();
    return { company, issues: companyIssues(company) };
  });

export const saveCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(companySchema)
  .handler(async ({ data, context }) => {
    await loadCompany();
    await withActor(context.user.id, (tx) =>
      tx.update(schema.company).set({ ...data, updatedAt: new Date() }),
    );
    return { ok: true };
  });
