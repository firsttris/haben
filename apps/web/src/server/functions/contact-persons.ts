import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { contactPersonInputSchema, createContactPerson, listContactPersons, setContactPersonActive, updateContactPerson } from "../modules/stammdaten/index.ts";
import { detailId } from "./schemas.ts";

/** Ansprechpartner am Kontakt (#424) */
// Lädt neben getContactDetail auf der Kontaktseite: Eine kaputte Adresse muss auch hier „nicht gefunden“ sein (wie getMandates)
export const getContactPersons = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => ({ persons: (await listContactPersons(data)).map((p) => ({ ...p, deactivatedAt: p.deactivatedAt?.toISOString() ?? null })) }));

export const saveContactPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contactId: z.uuid(), id: z.uuid().optional(), person: contactPersonInputSchema }))
  .handler(async ({ data, context }) => {
    if (data.id) {
      await updateContactPerson(context.user.id, data.id, data.person);
      return { id: data.id };
    }
    return { id: await createContactPerson(context.user.id, data.contactId, data.person) };
  });

export const setContactPersonActiveFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), active: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setContactPersonActive(context.user.id, data.id, data.active);
    return { ok: true };
  });
