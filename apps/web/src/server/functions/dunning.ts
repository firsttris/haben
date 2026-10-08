import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDunning, dunningDraft, dunningInputSchema, overdueInvoices } from "../dunning.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

export const getOverdue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ items: await overdueInvoices(today()), today: today() }));

export const getDunningDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(({ data }) => dunningDraft(data, today()));

export const createDunningFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(dunningInputSchema)
  .handler(async ({ data, context }) => {
    const created = await createDunning(context.user.id, data, today());
    return { id: created.id };
  });
