import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createUnit, listUnits, setUnitArchived } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Eigene Mengeneinheiten (#748), auch archivierte */
export const getUnits = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listUnits());

export const addUnit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ label: z.string().max(40), code: z.string().max(3) }))
  .handler(async ({ data, context }) => {
    const unit = await createUnit(context.user.id, data);
    return { id: unit.id };
  });

export const archiveUnit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setUnitArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });
