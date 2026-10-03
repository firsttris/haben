import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { createPauschale, listPauschalen, PauschaleError, pauschaleInputSchema, reversePauschale } from "../pauschalen.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof PauschaleError) throw new Error(error.message);
  throw error;
}

export const getPauschalen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.number().int().min(2000).max(2100))
  .handler(async ({ data: year }) => ({ ...(await listPauschalen(year)), today: today() }));

export const createPauschaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(pauschaleInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createPauschale(context.user.id, data, today()).catch(asUserError);
    return { id: row.id, amount: row.amount };
  });

export const reversePauschaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reversePauschale(context.user.id, data).catch(asUserError);
    return { ok: true };
  });
