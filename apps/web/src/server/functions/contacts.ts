import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { contactHistory } from "../modules/auswertungen/index.ts";
import { contactSchema, createContact, findContactsByUstId, getContact, listContacts, setContactArchived, updateContact } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { detailId, yearSchema } from "./schemas.ts";

export const getContacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ archived: z.boolean().default(false), role: z.enum(["kunde", "lieferant"]).optional() }))
  .handler(({ data }) => listContacts(data.archived, data.role));

/** Hinweis beim Eintippen einer USt-IdNr.: gibt es sie schon bei einem Kontakt, gleich welcher Rolle? */
export const findContactsByUstIdFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ ustId: z.string().max(40), excludeId: z.uuid().optional() }))
  .handler(({ data }) => findContactsByUstId(data.ustId, data.excludeId));

export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const result = await getContact(data);
    if (!result) throw notFound();
    return result;
  });

/** Rechnungen und Belege des Kontakts mit Summen je Jahr, aus Haben und dem Altbestand (#587); nur lesend */
export const getContactHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string; year?: number }) => ({ id: detailId(input.id), year: yearSchema.optional().parse(input.year) }))
  .handler(({ data }) => contactHistory(data.id, today(), data.year));

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
