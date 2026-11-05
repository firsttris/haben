import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { contactSchema, createContact, getContact, listContacts, setContactArchived, updateContact } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { detailId } from "./schemas.ts";

export const getContacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ archived: z.boolean().default(false), role: z.enum(["kunde", "lieferant"]).optional() }))
  .handler(({ data }) => listContacts(data.archived, data.role));

export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const result = await getContact(data);
    if (!result) throw notFound();
    return result;
  });

export const saveContact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), contact: contactSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id ? await updateContact(context.user.id, data.id, data.contact) : await createContact(context.user.id, data.contact);
    return { id: saved.id };
  });

export const archiveContact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setContactArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });
