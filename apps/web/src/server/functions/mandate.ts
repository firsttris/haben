import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";
import { addMandateFile, createMandate, listMandates, mandateInputSchema, revocationInputSchema, revokeMandate } from "../modules/stammdaten/index.ts";
import { today } from "../today.ts";
import { detailId } from "./schemas.ts";

/** SEPA-Lastschriftmandate am Kontakt (#445) */
// Lädt neben getContactDetail auf der Kontaktseite: Eine kaputte Adresse muss auch hier „nicht gefunden“ sein, sonst
// gewinnt je nach Reihenfolge der Validierungsfehler (500 statt 404, e2e/seiten.spec.ts)
export const getMandates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(async ({ data }) => {
    const day = today();
    return { mandates: await listMandates(data, day), today: day };
  });

export const saveMandate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contactId: z.uuid(), mandate: mandateInputSchema }))
  .handler(async ({ data, context }) => ({ id: await createMandate(context.user.id, data.contactId, data.mandate, today()) }));

export const revokeMandateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), revocation: revocationInputSchema }))
  .handler(async ({ data, context }) => {
    await revokeMandate(context.user.id, data.id, data.revocation);
    return { ok: true };
  });

/** Unterschriebenes Mandat als PDF hochladen */
export const uploadMandateFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const id = z.uuid().safeParse(data.get("id"));
    if (!id.success) throw new UserError("Mandat fehlt.");
    const file = data.get("file");
    if (!(file instanceof File)) throw new UserError("Keine Datei ausgewählt.");
    if (file.size > MAX_DOCUMENT_SIZE) throw new UserError(`${file.name}: größer als 20 MB.`);
    return { id: id.data, file };
  })
  .handler(async ({ data, context }) => {
    await addMandateFile(context.user.id, data.id, { bytes: new Uint8Array(await data.file.arrayBuffer()), filename: data.file.name });
    return { ok: true };
  });
