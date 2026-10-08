import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { createPauschale, listPauschalen, pauschaleInputSchema, reversePauschale } from "../pauschalen.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

export const getPauschalen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => ({ ...(await listPauschalen(year)), today: today() }));

export const createPauschaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(pauschaleInputSchema)
  .handler(async ({ data, context }) => {
    const row = await createPauschale(context.user.id, data, today());
    return { id: row.id, amount: row.amount };
  });

export const reversePauschaleFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reversePauschale(context.user.id, data);
    return { ok: true };
  });
