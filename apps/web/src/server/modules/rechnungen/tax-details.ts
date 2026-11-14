import { section4Note, type OutgoingTaxDetails, type TaxTreatment } from "@haben/core";
import { LAENDERCODES } from "@haben/einvoice";
import { z } from "zod";

/** Keine Auswertung des bisherigen Freitexts; null bleibt eine ungeklärte Zuordnung. */
export const outgoingTaxDetailsSchema = z
  .object({
    exemption: z
      .object({
        number: z.string().regex(/^(?:[1-9]|[12][0-9])(?:[abc])?$/),
        letter: z
          .string()
          .regex(/^[a-i]$/)
          .nullable()
          .optional(),
      })
      .nullable(),
    ancillary: z.boolean().nullable(),
    foreignPlace: z
      .object({ country: z.string().refine((value) => LAENDERCODES.has(value), "Leistungsort: gültigen Ländercode wählen"), noForeignVat: z.boolean() })
      .nullable(),
    assetDisposal: z.boolean(),
  })
  .nullable()
  .default(null)
  .describe("Ausdrücklich zugeordnete Befreiung und tatsächlicher Leistungsort; null = ungeklärt, keine Auswertung des freien Hinweises");

/** Der gespeicherte Hinweis führt die ausdrücklich gewählte Vorschrift; alte Texte bleiben unangetastet. */
export function outgoingTaxColumns(input: { taxTreatment?: TaxTreatment; exemptionReason?: string; taxDetails?: OutgoingTaxDetails | null }) {
  const taxTreatment = input.taxTreatment ?? "regulaer";
  const taxDetails = outgoingTaxDetailsSchema.parse(input.taxDetails);
  return {
    taxTreatment,
    taxDetails,
    exemptionReason:
      taxTreatment === "regulaer" ? "" : (taxTreatment === "steuerfrei" && section4Note(taxDetails?.exemption)) || (input.exemptionReason ?? "").trim(),
  };
}
