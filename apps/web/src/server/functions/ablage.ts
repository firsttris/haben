import { createServerFn } from "@tanstack/react-start";
import { archiveTargetSchema, deleteArchiveTarget, deliverInvoices, saveArchiveTarget } from "../modules/ablage/index.ts";
import { authMiddleware } from "../middleware.ts";

export const saveArchiveTargetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(archiveTargetSchema)
  .handler(async ({ data, context }) => {
    await saveArchiveTarget(context.user.id, data);
    return { ok: true };
  });

export const removeArchiveTarget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteArchiveTarget(context.user.id);
    return { ok: true };
  });

/** Jetzt übertragen, auch Rechnungen nach vielen Fehlversuchen */
export const deliverArchiveNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => deliverInvoices(context.user.id, true));
