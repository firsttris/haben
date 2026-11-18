import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { bestaetigeUstId, ustIdBestaetigungen } from "../modules/stammdaten/index.ts";
import { detailId } from "./schemas.ts";

/** Bestätigungen der USt-IdNr. beim BZSt am Kontakt (#1385) */
// Lädt neben getContactDetail auf der Kontaktseite: eine kaputte Adresse ist auch hier „nicht gefunden“ (wie getMandates)
export const getUstIdBestaetigungen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(detailId)
  .handler(({ data }) => ustIdBestaetigungen(data));

/** Auf Knopfdruck, oder nach dem Speichern des Kontakts mit nurWennFaellig */
export const bestaetigeUstIdFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contactId: z.uuid(), nurWennFaellig: z.boolean().default(false) }))
  .handler(({ data, context }) => bestaetigeUstId(context.user.id, data.contactId, { nurWennFaellig: data.nurWennFaellig }));
