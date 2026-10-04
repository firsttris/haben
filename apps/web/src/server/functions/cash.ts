import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cashBook, CashError, cashInputSchema, createCashEntry, reverseCashEntry } from "../cash.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof CashError) throw new Error(error.message);
  throw error;
}

export const getCashBook = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.number().int().min(2000).max(2100))
  .handler(async ({ data: year }) => ({ ...(await cashBook(year)), today: today() }));

export const createCashEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cashInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createCashEntry(context.user.id, data, today()).catch(asUserError);
    return { number: row.number };
  });

export const reverseCashEntryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const row = await reverseCashEntry(context.user.id, data, today()).catch(asUserError);
    return { number: row.number };
  });
