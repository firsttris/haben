import { PRICE_MODES, TAX_TREATMENT_KEYS } from "@haben/core";
import { z } from "zod";
import { draftSchema, externalReferenceSchema } from "../rechnungen/index.ts";
import { contactSchema as contactInputSchema } from "../stammdaten/index.ts";

/*
 * Schemas der REST-API: Eingaben, Antworten und Fehler. Die Eingaben bauen auf den Schemas der Module auf (contactSchema,
 * draftSchema), damit die API genau so prüft wie die Oberfläche; aus allen zusammen entsteht die OpenAPI-Beschreibung
 * (openapi.ts). Die Tests prüfen die Antworten gegen die Antwort-Schemas, damit die Beschreibung stimmt.
 *
 * Geld in ganzen Cent, Steuersätze in Basispunkten (1900 = 19 %), Mengen in Tausendsteln (1 Stück = 1000), wie überall
 * in Haben.
 */

/** Benannte Schemas für components/schemas der OpenAPI-Beschreibung: Eingaben als Eingabe-, Antworten als Ausgabetyp */
export const requestSchemas = z.registry<{ id: string }>();
export const responseSchemas = z.registry<{ id: string }>();

const CENTS = "Betrag in ganzen Cent (Euro), z. B. 5712 = 57,12 €";
const isoDate = z.iso.date();
const timestamp = z.iso.datetime({ offset: true }).describe("Zeitpunkt nach ISO 8601");

// ── Fehler ────────────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "method_not_allowed",
  "invalid_json",
  "unsupported_media_type",
  "payload_too_large",
  "validation_failed",
  "conflict",
  "unprocessable",
  "rate_limited",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES).describe("Maschinenlesbare Art des Fehlers"),
      message: z.string().describe("Meldung auf Deutsch, für Menschen"),
      issues: z
        .array(z.object({ path: z.string().describe("Feld mit Punkten, z. B. lines.0.quantity"), message: z.string() }))
        .optional()
        .describe("Nur bei validation_failed: was an welchem Feld nicht stimmt"),
    }),
  })
  .register(responseSchemas, { id: "Error" });

// ── Listen ────────────────────────────────────────────────────────────────────

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(500).default(100).describe("Höchstens so viele Einträge, 1 bis 500"),
  offset: z.coerce.number().int().min(0).default(0).describe("So viele Einträge überspringen"),
};

const page = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    total: z.number().int().describe("Anzahl aller Treffer, unabhängig von limit und offset"),
    limit: z.number().int(),
    offset: z.number().int(),
  });

// ── Kontakte ──────────────────────────────────────────────────────────────────

const contactFields = contactInputSchema.shape;

/** Neuer Kontakt: nur der Name ist Pflicht, der Rest hat die Vorgaben der Oberfläche */
export const contactCreateSchema = z
  .object({
    ...contactInputSchema.partial().shape,
    name: contactFields.name,
    kundennummer: contactFields.kundennummer.optional().describe("Leer: Haben vergibt die nächste Kundennummer, wenn ein Format eingestellt ist"),
    land: contactFields.land.optional().describe("Ländercode nach ISO 3166-1, Vorgabe DE"),
    email: contactFields.email.optional().describe("Eine oder mehrere Adressen, durch Komma getrennt"),
  })
  .strict()
  .register(requestSchemas, { id: "ContactCreate" });

/** Änderung: nur die genannten Felder, der Rest bleibt */
export const contactPatchSchema = contactInputSchema.partial().strict().register(requestSchemas, { id: "ContactPatch" });

export const CONTACT_DEFAULTS = {
  kundennummer: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  email: "",
  ustId: "",
  iban: "",
  leitwegId: "",
  defaultFormat: null,
  language: "de",
} as const;

export const contactSchema = z
  .object({
    id: z.uuid(),
    kundennummer: z.string().nullable(),
    name: z.string(),
    strasse: z.string(),
    plz: z.string(),
    ort: z.string(),
    land: z.string(),
    email: z.string(),
    ustId: z.string(),
    iban: z.string(),
    leitwegId: z.string(),
    defaultFormat: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]).nullable(),
    language: z.enum(["de", "en"]),
    version: z.number().int().describe("Steigt mit jeder Änderung; alte Stände bleiben in Haben erhalten"),
    archived: z.boolean(),
    url: z.url().describe("Seite des Kontakts in Haben"),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .register(responseSchemas, { id: "Contact" });

export const contactListSchema = page(contactSchema).register(responseSchemas, { id: "ContactList" });

export const contactQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().describe("Sucht in Name, E-Mail und Kundennummer, ohne Groß- und Kleinschreibung"),
    archived: z.enum(["true", "false"]).default("false").describe("true: auch archivierte Kontakte"),
    ...pageQuery,
  })
  .strict();

// ── Rechnungen ────────────────────────────────────────────────────────────────

const draftFields = draftSchema.shape;
const lineFields = draftFields.lines.element.shape;

const lineInputSchema = z
  .object({
    ...lineFields,
    // Die Felder kommen aus @haben/core (zod/mini) und kennen kein .describe; z.describe als Prüfung gibt es für beide
    quantity: lineFields.quantity.check(z.describe("Menge in Tausendsteln: 1 Stück = 1000, 1,5 Stunden = 1500")),
    unitPrice: lineFields.unitPrice.check(z.describe("Einzelpreis in Cent, netto oder brutto je nach priceMode")),
    taxRate: lineFields.taxRate.check(z.describe("Steuersatz in Basispunkten: 1900 = 19 %, 700 = 7 %, 0")),
    detail: lineFields.detail.describe("Mehrzeiliger Text unter der Bezeichnung (BT-154)"),
  })
  .strict()
  .register(requestSchemas, { id: "InvoiceLineInput" });

/**
 * Felder eines Entwurfs, die die API annimmt. Abschlags- und Schlussrechnung, Bezug auf ein Angebot und abzuziehende
 * Abschläge bleiben der Oberfläche vorbehalten, ebenso Storno und Korrektur.
 */
const draftApiFields = {
  contactId: draftFields.contactId.describe("Kontakt aus /kontakte; null = noch ohne Kunde"),
  issueDate: draftFields.issueDate.describe("Rechnungsdatum JJJJ-MM-TT, Vorgabe heute"),
  serviceFrom: draftFields.serviceFrom,
  serviceTo: draftFields.serviceTo,
  paymentTermDays: draftFields.paymentTermDays.describe("Zahlungsziel in Tagen, Vorgabe aus den Firmendaten"),
  format: draftFields.format.describe("Vorgabe: Standardformat des Kontakts, mit Leitweg-ID XRechnung, sonst aus den Firmendaten"),
  intro: draftFields.intro.describe("Kopftext über den Positionen"),
  note: draftFields.note.describe("Fußtext unter den Summen"),
  taxTreatment: draftFields.taxTreatment,
  exemptionReason: draftFields.exemptionReason,
  priceMode: draftFields.priceMode.describe("Einzelpreise netto oder brutto inkl. USt"),
  language: draftFields.language.describe("Sprache des PDFs, Vorgabe die des Kontakts"),
  currency: draftFields.currency.describe("Währung als dreistelliger Code, Vorgabe EUR"),
  exchangeRate: draftFields.exchangeRate.describe("1 EUR = Kurs, z. B. 1,0812; leer = USt-Umrechnungskurs des Leistungsmonats"),
  exchangeRateDate: draftFields.exchangeRateDate,
  lines: z.array(lineInputSchema).min(1, "Mindestens eine Position").max(200),
};

const referenceFields = {
  externalSource: externalReferenceSchema.shape.externalSource.describe("Plattform des Vorgangs, z. B. etsy oder ebay; nur zusammen mit externalId"),
  externalId: externalReferenceSchema.shape.externalId.describe("Bestellnummer auf der Plattform; mit externalSource eindeutig"),
};

const optional = <T extends Record<string, z.ZodType>>(shape: T) =>
  Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.optional()])) as { [K in keyof T]: z.ZodOptional<T[K]> };

export const draftCreateSchema = z
  .object({ ...optional(draftApiFields), lines: draftApiFields.lines, ...optional(referenceFields) })
  .strict()
  .refine((d) => (d.externalSource === undefined) === (d.externalId === undefined), {
    message: "externalSource und externalId nur zusammen angeben",
    path: ["externalId"],
  })
  .register(requestSchemas, { id: "InvoiceDraftCreate" });

/** Änderung eines Entwurfs: nur die genannten Felder; lines ersetzt alle Positionen. Die Referenz bleibt. */
export const draftPatchSchema = z.object(optional(draftApiFields)).strict().register(requestSchemas, { id: "InvoiceDraftPatch" });

const lineSchema = z.object({
  position: z.number().int(),
  description: z.string(),
  detail: z.string(),
  quantity: z.number().int().describe("Tausendstel"),
  unit: z.string(),
  unitPrice: z.number().int().describe("Cent, wie eingegeben (netto oder brutto)"),
  taxRate: z.number().int().describe("Basispunkte"),
  net: z.number().int().describe("Zeilennetto in Cent"),
});

const LIST_STATUS = ["entwurf", "offen", "teilbezahlt", "bezahlt", "ausgebucht", "ueberfaellig", "storniert", "storno", "korrektur"] as const;

const invoiceSummaryShape = {
  id: z.uuid(),
  kind: z.enum(["rechnung", "storno", "korrektur"]),
  status: z.enum(["draft", "final"]).describe("draft = Entwurf, änderbar; final = festgeschrieben, unveränderlich"),
  listStatus: z.enum(LIST_STATUS).describe("Stand wie in der Rechnungsliste von Haben"),
  number: z.string().nullable().describe("Rechnungsnummer, erst ab dem Festschreiben"),
  contactId: z.uuid().nullable(),
  customer: z.string().describe("Name des Kunden"),
  issueDate: isoDate,
  dueDate: isoDate,
  net: z.number().int().describe(CENTS),
  gross: z.number().int().describe(CENTS),
  paid: z.number().int().describe(`Bezahlt laut Bankabgleich; ${CENTS}`),
  open: z.number().int().describe(`Noch offen; ${CENTS}`),
  externalSource: z.string().nullable(),
  externalId: z.string().nullable(),
  url: z.url().describe("Seite der Rechnung in Haben, dort wird festgeschrieben und versendet"),
};

export const invoiceSummarySchema = z.object(invoiceSummaryShape).register(responseSchemas, { id: "InvoiceSummary" });
export const invoiceListSchema = page(invoiceSummarySchema).register(responseSchemas, { id: "InvoiceList" });

export const invoiceSchema = z
  .object({
    ...invoiceSummaryShape,
    correctsId: z.uuid().nullable().describe("Storno und Korrektur: die ursprüngliche Rechnung"),
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    paymentTermDays: z.number().int(),
    format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
    intro: z.string(),
    note: z.string(),
    language: z.enum(["de", "en"]),
    taxTreatment: z.enum(TAX_TREATMENT_KEYS),
    exemptionReason: z.string(),
    priceMode: z.enum(PRICE_MODES),
    currency: z.string(),
    exchangeRate: z.string().nullable().describe("1 EUR = Kurs; Beträge in Cent sind bei Fremdwährung in Euro umgerechnet"),
    tax: z.number().int().describe(CENTS),
    lines: z.array(lineSchema),
    createdAt: timestamp,
    updatedAt: timestamp,
    lockedAt: timestamp.nullable().describe("Zeitpunkt des Festschreibens"),
  })
  .register(responseSchemas, { id: "Invoice" });

export const invoiceQuerySchema = z
  .object({
    status: z.enum(["draft", "final"]).optional(),
    kind: z.enum(["rechnung", "storno", "korrektur"]).optional(),
    contactId: z.uuid().optional(),
    externalSource: z.string().trim().min(1).max(40).optional().describe("Nur Rechnungen dieser Plattform"),
    externalId: z.string().trim().min(1).max(100).optional().describe("Mit externalSource: die Rechnung zu dieser Bestellung"),
    ...pageQuery,
  })
  .strict();
