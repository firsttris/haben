import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDunning, DunningError, dunningDraft, dunningInputSchema, overdueInvoices } from "../dunning.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof DunningError) throw new Error(error.message);
  throw error;
}

export const getOverdue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ items: await overdueInvoices(today()), today: today() }));

export const getDunningDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(({ data }) => dunningDraft(data, today()).catch(asUserError));

export const createDunningFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(dunningInputSchema)
  .handler(async ({ data, context }) => {
    const created = await createDunning(context.user.id, data, today()).catch(asUserError);
    return { id: created.id };
  });
