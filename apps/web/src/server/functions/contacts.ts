import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ContactError,
  contactSchema,
  createContact,
  getContact,
  listContacts,
  setContactArchived,
  updateContact,
} from "../contacts.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof ContactError) throw new Error(error.message);
  throw error;
}

export const getContacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ archived: z.boolean().default(false) }))
  .handler(({ data }) => listContacts(data.archived));

export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getContact(data);
    if (!result) throw new Error("Kontakt nicht gefunden.");
    return result;
  });

export const saveContact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), contact: contactSchema }))
  .handler(async ({ data, context }) => {
    const saved = data.id
      ? await updateContact(context.user.id, data.id, data.contact).catch(asUserError)
      : await createContact(context.user.id, data.contact);
    return { id: saved.id };
  });

export const archiveContact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setContactArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });
