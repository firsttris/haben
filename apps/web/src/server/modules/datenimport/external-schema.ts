import { EXPENSE_CATEGORY_KEYS, UNITS, LINE_DETAIL_MAX, type UnitLabel } from "@haben/core";
import { z } from "zod";

const cents = z.number().int().min(-2_147_483_647).max(2_147_483_647);
const key = z.string().trim().min(1).max(200);
const party = z.object({
  name: z.string().trim().min(1).max(300),
  strasse: z.string().max(300),
  plz: z.string().max(20),
  ort: z.string().max(100),
  land: z.string().regex(/^[A-Z]{2}$/),
  email: z.string().max(500).optional(),
  kundennummer: z.string().max(100).optional(),
});
const line = z.object({
  description: z.string().trim().min(1).max(500),
  detail: z.string().max(LINE_DETAIL_MAX).default(""),
  quantity: z.number().int().positive().max(1_000_000_000),
  unit: z.enum(Object.keys(UNITS) as [UnitLabel, ...UnitLabel[]]),
  unitPrice: cents,
  kind: z.enum(["optional", "alternative"]).nullable().default(null),
});
const document = {
  externalId: key,
  number: key,
  date: z.iso.date(),
  contactId: z.uuid().nullable(),
  buyer: party,
  gross: cents,
  lines: z.array(line).min(1).max(200),
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  serviceFrom: z.iso.date().nullable().default(null),
  serviceTo: z.iso.date().nullable().default(null),
  note: z.string().max(2000).default(""),
  evidence: z.record(z.string(), z.unknown()).default({}),
};

export const externalQuoteSchema = z.object({
  ...document,
  kind: z.literal("quote"),
  validUntil: z.iso.date().nullable(),
  decision: z.enum(["angenommen", "abgelehnt"]).nullable().default(null),
});
export const externalInvoiceSchema = z.object({
  ...document,
  gross: cents.positive(),
  kind: z.literal("invoice"),
  dueDate: z.iso.date(),
  quoteExternalId: key.nullable().default(null),
  /** Übernommener Zahlungsstand; ohne nachgewiesenen Zufluss entsteht daraus keine EÜR-Einnahme. */
  settledAmount: cents.default(0),
  paymentUncertain: z.boolean().default(false),
});
const postingLine = z
  .object({
    account: z.string().regex(/^\d{4,8}$/),
    debit: cents.nonnegative(),
    credit: cents.nonnegative(),
  })
  .refine((l) => l.debit === 0 || l.credit === 0, "Eine Buchungszeile hat nur Soll oder Haben.");
export const externalJournalSchema = z.object({
  kind: z.literal("journal"),
  externalId: key,
  date: z.iso.date(),
  description: z.string().min(1).max(2000),
  lines: z.array(postingLine).min(2).max(200),
  evidence: z.record(z.string(), z.unknown()).default({}),
  /** Nur belegte Zu-/Abflüsse (§ 11 EStG), unabhängig von übernommenen Bezahlt-Markierungen. */
  cashFlows: z
    .array(
      z.object({
        date: z.iso.date(),
        amount: cents.refine((n) => n !== 0, "Zahlbetrag fehlt."),
        category: z.enum(["einnahme", ...EXPENSE_CATEGORY_KEYS]),
        evidence: z.string().min(1).max(2000),
      }),
    )
    .max(100)
    .default([]),
});

export const externalImportSchema = z.object({
  version: z.literal(1),
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
