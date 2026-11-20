import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { bestaetigeUstId, ustIdBestaetigungen, ustIdVorBuchen, ustIdVorFestschreiben } from "../modules/stammdaten/index.ts";
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

/** Beim Öffnen der Rückfrage zum Festschreiben einer Rechnung mit Reverse Charge oder innergemeinschaftlicher Lieferung */
export const ustIdVorFestschreibenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contactId: z.uuid(), behandlung: z.enum(["reverse_charge", "ig_lieferung"]) }))
  .handler(({ data, context }) => ustIdVorFestschreiben(context.user.id, data.contactId, data.behandlung));

/** Beim Öffnen der Rückfrage zum Buchen eines Belegs mit § 1a oder § 13b für eine EU-Leistung, mit dem Stand im Formular (#1490) */
export const ustIdVorBuchenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ contactId: z.uuid().nullable(), ustId: z.string().max(40), behandlung: z.enum(["ig_erwerb", "eu"]) }))
  .handler(({ data, context }) => ustIdVorBuchen(context.user.id, data));
