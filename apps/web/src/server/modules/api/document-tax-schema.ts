import { inBasisPoints, inCents } from "@haben/core";
import { z } from "zod";

/** Steuerfelder der Belegantwort; die Satzanteile bleiben neben der ausgewiesenen Originalsteuer sichtbar. */
export const documentTaxShape = {
  vorsteuerAnteil: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .nullable()
    .describe("Abziehbarer Anteil in Basispunkten; bei Entwürfen null = Firmenvorgabe, gebucht historisch festgehalten"),
  vorsteuerAbzug: z.boolean().describe("Gespeichert: wenigstens ein Steuersatz erlaubt Vorsteuerabzug; Rückfall für Altbelege ohne Anteil"),
  amounts: z
    .array(
      z.object({
        taxRate: inBasisPoints(z.number().int()).describe("Basispunkte"),
        net: inCents(z.number().int()),
        tax: inCents(z.number().int()),
        vorsteuerAnteil: inBasisPoints(z.number().int().min(0).max(10_000))
          .nullable()
          .describe("Abziehbarer Anteil in Basispunkten; null erbt den Beleganteil"),
      }),
    )
    .describe("Beträge je Steuersatz in Euro-Cent"),
};
