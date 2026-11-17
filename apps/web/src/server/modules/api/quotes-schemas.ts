import { inCents, QUOTE_LINE_KINDS, type QuoteListStatus } from "@haben/core";
import { z } from "zod";
import { CENTS, invoiceSchema, isoDate, page, pageQuery, responseSchemas, timestamp } from "./schemas.ts";

/*
 * Schemas der REST-API für Angebote (#297), nur zum Lesen. Positionen, Steuerangaben und Referenzen beschreibt sie wie bei
 * der Rechnung. Rabatte stecken wie dort in net und gross; einzeln weist die API sie nicht aus.
 */

const invoiceFields = invoiceSchema.shape;

/** Stand wie in der Angebotsliste von Haben; satisfies hält die Liste beim Typ aus @haben/core (lebenszyklus.ts) */
const LIST_STATUS = ["entwurf", "offen", "abgelaufen", "angenommen", "abgelehnt", "abgerechnet"] as const satisfies readonly QuoteListStatus[];

const quoteSummaryShape = {
  id: z.uuid(),
  status: z.enum(["draft", "final"]).describe("draft = Entwurf, änderbar; final = festgeschrieben, unveränderlich"),
  listStatus: z.enum(LIST_STATUS).describe("Stand wie in der Angebotsliste von Haben; abgerechnet, sobald aus dem Angebot eine Rechnung entstanden ist"),
  number: z.string().nullable().describe("Angebotsnummer, erst ab dem Festschreiben"),
  contactId: z.uuid().nullable(),
  customer: z.string().describe("Name des Kunden"),
  issueDate: isoDate,
  validUntil: isoDate.describe("Gültig bis einschließlich"),
  net: inCents(z.number().int()).describe(`Ohne optionale und alternative Positionen; ${CENTS}`),
  gross: inCents(z.number().int()).describe(`Ohne optionale und alternative Positionen; ${CENTS}`),
  decision: z.enum(["angenommen", "abgelehnt"]).nullable().describe("Antwort des Kunden, in Haben eingetragen; null = noch keine"),
  invoiceId: z.uuid().nullable().describe("Rechnung, die aus dem Angebot entstanden ist"),
  invoiceNumber: z.string().nullable().describe("Nummer dieser Rechnung; null, solange sie Entwurf ist"),
  url: z.url().describe("Seite des Angebots in Haben, dort wird festgeschrieben, versendet und abgerechnet"),
};

export const quoteSummarySchema = z.object(quoteSummaryShape).register(responseSchemas, { id: "QuoteSummary" });
export const quoteListSchema = page(quoteSummarySchema).register(responseSchemas, { id: "QuoteList" });

const quoteLineSchema = invoiceFields.lines.element.extend({
  kind: z.enum(QUOTE_LINE_KINDS).nullable().describe("optional oder alternative zur Hauptposition davor: zählt nicht zur Summe; null = normale Position"),
});

export const quoteSchema = z
  .object({
    ...quoteSummaryShape,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    intro: z.string().describe("Kopftext über den Positionen"),
    note: z.string(),
    buyerOrderReference: invoiceFields.buyerOrderReference,
    sellerOrderReference: invoiceFields.sellerOrderReference,
    despatchAdviceReference: invoiceFields.despatchAdviceReference,
    language: invoiceFields.language,
    taxTreatment: invoiceFields.taxTreatment,
    exemptionReason: invoiceFields.exemptionReason,
    taxDetails: invoiceFields.taxDetails,
    priceMode: invoiceFields.priceMode,
    tax: inCents(z.number().int()).describe(CENTS),
    decidedAt: timestamp.nullable().describe("Zeitpunkt, zu dem die Antwort des Kunden eingetragen wurde"),
    lines: z.array(quoteLineSchema),
    choices: z
      .array(z.number().int())
      .describe("Vom Kunden gewählte optionale und alternative Positionen (position); Rechnung und Abschläge übernehmen nur diese"),
    createdAt: timestamp,
    updatedAt: timestamp,
    lockedAt: timestamp.nullable().describe("Zeitpunkt des Festschreibens"),
  })
  .register(responseSchemas, { id: "Quote" });

export const quoteQuerySchema = z
  .object({
    status: z.enum(["draft", "final"]).optional(),
    contactId: z.uuid().optional(),
    number: z.string().trim().min(1).max(40).optional().describe("Nur das Angebot mit dieser Nummer"),
    ...pageQuery,
  })
  .strict();
