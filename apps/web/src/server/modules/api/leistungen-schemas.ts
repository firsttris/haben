import { z } from "zod";
import { isRealDate, serviceEntrySchema } from "../leistungen/index.ts";
import { isoDate, page, pageQuery, requestSchemas, responseSchemas } from "./schemas.ts";

/* Schemas der REST-API für Leistungseinträge (#417). Die Eingabe baut auf serviceEntrySchema des Moduls auf, damit die API wie die Oberfläche prüft. */

const fields = serviceEntrySchema.shape;

export const serviceEntryCreateSchema = z
  .object({
    contactId: fields.contactId.describe("Kunde, dem die Leistung gehört"),
    workedOn: fields.workedOn.describe("Arbeitstag, JJJJ-MM-TT"),
    minutes: fields.minutes.describe("Dauer in ganzen Minuten, 1 bis 1440"),
    description: fields.description.optional().describe("Tätigkeit; steht später auf der Rechnung"),
    hourlyRateCents: fields.hourlyRateCents.describe("Stundensatz in Cent; fehlt: der Satz des Kunden zum Zeitpunkt des Anlegens"),
    source: z.string().trim().min(1).max(40).optional().describe("Quelle der Zeile, z. B. kimai; nur zusammen mit externalId"),
    externalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Kennung der Zeile in der Quelle; derselbe Aufruf noch einmal ändert den Eintrag, statt ihn zu verdoppeln"),
  })
  .strict()
  .refine((v) => (v.source === undefined) === (v.externalId === undefined), { message: "Quelle und Kennung gehören zusammen", path: ["externalId"] })
  .register(requestSchemas, { id: "ServiceEntryCreate" });

export const serviceEntrySchemaOut = z
  .object({
    id: z.uuid(),
    contactId: z.uuid(),
    workedOn: isoDate,
    minutes: z.number().int(),
    description: z.string(),
    hourlyRateCents: z.number().int().nullable().describe("Stundensatz in Cent, null: keiner bekannt (Abrechnen verlangt dann einen)"),
    source: z.string().nullable(),
    externalId: z.string().nullable(),
  })
  .register(responseSchemas, { id: "ServiceEntry" });

export const serviceEntryListSchema = page(serviceEntrySchemaOut).register(responseSchemas, { id: "ServiceEntryList" });

export const serviceEntryQuerySchema = z.object({
  contactId: z.uuid().optional().describe("Nur Einträge dieses Kunden"),
  from: isoDate.refine(isRealDate, "Datum ungültig").optional().describe("Arbeitstag ab einschließlich"),
  to: isoDate.refine(isRealDate, "Datum ungültig").optional().describe("Arbeitstag bis einschließlich"),
  ...pageQuery,
});
