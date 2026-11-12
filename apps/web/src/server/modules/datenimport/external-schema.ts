import { LEGACY_TAX_TYPES, type TaxCode } from "@haben/core";
import { z } from "zod";

const cents = z.number().int().min(-2_147_483_647).max(2_147_483_647);
const key = z.string().trim().min(1).max(200);
const tax = z.strictObject({ rate: z.number().int().min(0).max(10000), net: cents, tax: cents });
const original = {
  externalId: key,
  number: key,
  date: z.iso.date(),
  contactId: z.uuid().nullable(),
  contactName: z.string().trim().min(1).max(300),
  address: z
    .strictObject({
      name: z.string().max(300),
      street: z.string().max(300),
      zip: z.string().max(20),
      city: z.string().max(100),
      countryCode: z.string().regex(/^[A-Z]{2}$/),
    })
    .optional(),
  currency: z.literal("EUR"),
  net: cents,
  tax: cents,
  gross: cents,
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  note: z.string().max(2000).default(""),
  evidence: z.record(z.string(), z.unknown()).default({}),
};

export const externalQuoteSchema = z.strictObject({
  ...original,
  kind: z.literal("quote"),
  documentKind: z.enum(["AN", "AB", "LI"]).default("AN"),
  status: z.enum(["draft", "open", "declined", "accepted", "partlyInvoiced", "invoiced"]),
  validUntil: z.iso.date().nullable().default(null),
  positions: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  relatedObjects: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
});

export const externalInvoiceSchema = z.strictObject({
  ...original,
  kind: z.literal("invoice"),
  type: z.enum(["invoice", "creditnote", "purchaseinvoice", "purchasecreditnote"]),
  direction: z.enum(["einnahme", "ausgabe"]),
  dueDate: z.iso.date().nullable(),
  serviceFrom: z.iso.date().nullable().default(null),
  serviceTo: z.iso.date().nullable().default(null),
  status: z.enum(["open", "paid", "partlyPaid", "voided", "unknown"]),
  taxes: z.array(tax).min(1).max(20),
  taxType: z.enum(LEGACY_TAX_TYPES as [string, ...string[]]),
  categories: z
    .array(z.strictObject({ categoryId: key, name: z.string().max(300), ...tax.shape }))
    .max(200)
    .default([]),
  payment: z
    .strictObject({
      openAmount: cents,
      paidDate: z.iso.date().nullable(),
      items: z
        .array(
          z.strictObject({
            date: z.iso.date(),
            amount: cents.refine((n) => n !== 0, "Zahlbetrag fehlt."),
            evidence: z.string().min(1).max(2000),
            account: z.string().max(300).nullable().default(null),
          }),
        )
        .max(1000),
    })
    .nullable(),
  positions: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
});

const taxCodes = [
  "USt19",
  "USt7",
  "frei",
  "RC",
  "Drittland",
  "Steuerfrei",
  "KU",
  "VSt19",
  "VSt7",
  "keineVSt",
  "RC13bEU",
  "RC13bDrittland",
  "VSt13b",
  "IGL",
  "Ausfuhr",
  "IGE19",
  "IGE7",
  "VStIGE",
  "EUSt",
] as const satisfies readonly TaxCode[];
export const externalJournalSchema = z.strictObject({
  kind: z.literal("journal"),
  externalId: key,
  date: z.iso.date(),
  description: z.string().min(1).max(2000),
  /** Quellidentität der ursprünglichen OP-Buchung derselben Quelle; keine Belegnummer und kein Zahlungsstatus. */
  settles: key.optional(),
  lines: z
    .array(
      z
        .strictObject({
          account: z.string().regex(/^\d{4,8}$/),
          debit: cents.nonnegative(),
          credit: cents.nonnegative(),
          taxCode: z.enum(taxCodes).nullable().default(null),
          basis: cents.optional(),
        })
        .refine((l) => l.debit === 0 || l.credit === 0, "Eine Buchungszeile hat nur Soll oder Haben."),
    )
    .min(2)
    .max(200),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

/** V2 verwendet den gemeinsamen Umzugsbestand. V1 wird nicht stillschweigend umgedeutet. */
export const externalImportSchema = z.strictObject({
  version: z.literal(2),
  source: key,
  kontenrahmen: z.enum(["SKR03", "SKR04"]),
  entries: z
    .array(z.discriminatedUnion("kind", [externalQuoteSchema, externalInvoiceSchema, externalJournalSchema]))
    .min(1)
    .max(10000),
});
export type ExternalQuote = z.output<typeof externalQuoteSchema>;
export type ExternalInvoice = z.output<typeof externalInvoiceSchema>;
export type ExternalJournal = z.output<typeof externalJournalSchema>;
export type ExternalImport = z.input<typeof externalImportSchema>;
