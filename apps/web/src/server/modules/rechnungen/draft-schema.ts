import {
  CURRENCY_CODE,
  discountSchema,
  documentDiscountProblem,
  INVOICE_PAYMENT_METHODS,
  lineDiscountProblem,
  parseExchangeRate,
  PRICE_MODES,
  skontoProblem,
  TAX_TREATMENT_KEYS,
  type PriceMode,
  type TaxTreatment,
} from "@haben/core";
import { z } from "zod";
import { today } from "../../today.ts";
import { invoiceDraftLineSchema } from "./draft-line.ts";
import { referenceFieldsSchema } from "./order-references.ts";
import { draftSkontoSchema } from "./skonto.ts";
import { outgoingTaxDetailsSchema } from "./tax-details.ts";

/* Eingabeschema eines Rechnungsentwurfs, wie es Editor, Server Functions und API prüfen */

const isoDate = z.iso.date();

export const draftSchema = z
  .object({
    contactId: z.uuid().nullable(),
    issueDate: isoDate,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    paymentTermDays: z.number().int().min(0).max(120),
    /** Skontostufen (Frist in Tagen, Satz in Basispunkten); nur bei Rechnungen in Euro */
    skonto: draftSkontoSchema,
    format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
    /** Einleitung über den Positionen, etwa aus einem Textbaustein */
    intro: z.string().max(2000).default(""),
    note: z.string().max(2000),
    propertyRetention: z.boolean().default(false),
    /** Bestellnummer des Kunden, eigene Auftragsnummer und Lieferschein (BT-13, BT-14, BT-16); leer = keine */
    ...referenceFieldsSchema,
    taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
    exemptionReason: z.string().trim().max(300).default(""),
    taxDetails: outgoingTaxDetailsSchema,
    /** Einzelpreise netto oder brutto inkl. USt; brutto nur bei regulärer Besteuerung */
    priceMode: z.enum(PRICE_MODES).default("netto"),
    /** Sprache des PDFs für den Kunden */
    language: z.enum(["de", "en"]).default("de"),
    /** Abschlags- oder Schlussrechnung; null = normale Rechnung */
    variant: z.enum(["abschlag", "schluss"]).nullable().default(null),
    advanceType: z.enum(["anzahlung", "teilleistung"]).nullable().optional(),
    /** Schlussrechnung: abzuziehende Abschlagsrechnungen */
    deducts: z.array(z.uuid()).max(50).default([]),
    /** Angebot, zu dem die Rechnung gehört (Abschlags- und Schlussrechnung, Rechnung aus dem Angebot) */
    quoteId: z.uuid().nullable().default(null),
    /** Währung der Rechnung; Preise und Summen in dieser Währung, gebucht wird in Euro mit dem Kurs */
    currency: z.string().trim().toUpperCase().regex(CURRENCY_CODE, "Währung als dreistelliger Code, z. B. USD").default("EUR"),
    /** 1 EUR = Kurs; leer = USt-Umrechnungskurs des Leistungsmonats, sobald veröffentlicht */
    exchangeRate: z
      .string()
      .nullable()
      .default(null)
      .transform((value, ctx) => {
        if (value === null || value.trim() === "") return null;
        const rate = parseExchangeRate(value);
        if (!rate) ctx.addIssue({ code: "custom", message: "Umrechnungskurs ungültig, z. B. 1,0812" });
        return rate;
      }),
    exchangeRateDate: isoDate.nullable().default(null),
    lines: z.array(invoiceDraftLineSchema).max(200),
    /** Gesamtrabatt in Prozent oder als fester Betrag im Preismodus; null = keiner */
    discount: z.nullable(discountSchema).default(null),
    paymentMethod: z.enum(INVOICE_PAYMENT_METHODS).default("ueberweisung"),
    sepaMandateId: z.uuid().nullable().default(null),
    paidVia: z.string().trim().max(120).nullable().default(null),
    paidOn: isoDate.nullable().default(null),
    /** Ansprechpartner des Kunden (#424); der Stand beim Festschreiben steht im Käufer des Belegs */
    contactPersonId: z.uuid().nullable().default(null),
  })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  })
  .superRefine((d, ctx) => {
    d.lines.forEach((line, i) => {
      const problem = lineDiscountProblem(line);
      if (problem) ctx.addIssue({ code: "custom", message: `Position ${i + 1}: ${problem}`, path: ["lines", i, "discount"] });
    });
    const discountProblem = documentDiscountProblem(d.lines, d.discount);
    if (discountProblem) ctx.addIssue({ code: "custom", message: discountProblem, path: ["discount"] });
  })
  .superRefine((d, ctx) => {
    if (d.paymentMethod === "bereits_bezahlt") {
      if (!d.paidVia) ctx.addIssue({ code: "custom", message: "Zahlungsdienst oder „bar“ angeben.", path: ["paidVia"] });
      if (!d.paidOn) ctx.addIssue({ code: "custom", message: "Zahlungsdatum angeben.", path: ["paidOn"] });
      else if (d.paidOn > today()) ctx.addIssue({ code: "custom", message: "Das Zahlungsdatum liegt in der Zukunft.", path: ["paidOn"] });
      return;
    }
    if (d.skonto.length === 0) return;
    // Der Bankabgleich erkennt Skonto am Betrag in Euro; bei Fremdwährung stimmt der nach dem Kurs nicht
    if (d.currency !== "EUR") ctx.addIssue({ code: "custom", message: "Skonto gibt es nur bei Rechnungen in Euro.", path: ["skonto"] });
    const problem = skontoProblem(d.skonto, d.paymentTermDays);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["skonto"] });
  });

export type DraftInput = z.input<typeof draftSchema>;
export type LineInput = DraftInput["lines"][number] & { deductionOf?: string };

/** Ohne Steuerausweis gibt es keine Bruttopreise: dort sind netto und brutto gleich */
export function effectivePriceMode(input: { priceMode?: PriceMode | undefined; taxTreatment?: TaxTreatment | undefined }): PriceMode {
  return (input.taxTreatment ?? "regulaer") === "regulaer" ? (input.priceMode ?? "netto") : "netto";
}
