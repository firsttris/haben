import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  createServiceEntry,
  deleteServiceEntry,
  listEntryCustomers,
  listServiceEntries,
  serviceEntrySchema,
  updateServiceEntry,
} from "../modules/leistungen/index.ts";

/** Leistungseinträge (#417): Liste mit Filter, Anlegen, Ändern, Löschen */
const filterSchema = z.object({
  contactId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const getServiceEntries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(filterSchema)
  .handler(async ({ data }) => ({
    entries: await listServiceEntries(data),
    customers: await listEntryCustomers(),
  }));

export const saveServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().optional(), entry: serviceEntrySchema }))
  .handler(async ({ data, context }) => {
    if (data.id) {
      await updateServiceEntry(context.user.id, data.id, data.entry);
      return { id: data.id };
    }
    return { id: await createServiceEntry(context.user.id, data.entry) };
  });

export const removeServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await deleteServiceEntry(context.user.id, data.id);
    return { ok: true };
  });
