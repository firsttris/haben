import {
  alternativeMain,
  computeInvoice,
  DEFAULT_OPTIONS,
  discountSchema,
  ITEM_NUMBER_MAX,
  LINE_DETAIL_MAX,
  letterheadDesignInputSchema,
  orderRateAmounts,
  paymentPlanSchema,
  planSchedule,
  QUOTE_LINE_KINDS,
  skontoStufeSchema,
  TAX_TREATMENT_KEYS,
  type UnitLabel,
} from "@haben/core";
import {
  asDraft,
  type Buyer,
  type InvoiceDocument,
  type Letterhead,
  pdfData,
  quotePdfData,
  type QuoteDocument,
  type RenderedSheet,
  renderJob,
  type SheetData,
  sheetText,
  type SheetTextPart,
  templateInputs,
  texts,
} from "@haben/einvoice";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import {
  type Company,
  customLayoutFor,
  customLayoutJob,
  dataForVersion,
  ansprechpartnerSnapshot,
  contactPersonProblem,
  getContact,
  layoutRenderer,
  loadCompany,
  loadLetterhead,
  rendererFor,
  typstMeldung,
} from "../stammdaten/index.ts";
import { buyerFrom, sellerFrom } from "./invoices.ts";
import { directDebitFor } from "./lastschrift.ts";
import { documentReferences, referenceColumns, referenceFieldsSchema } from "./order-references.ts";
import { quoteCalculation } from "./quotes.ts";
import { outgoingTaxColumns, outgoingTaxDetailsSchema } from "./tax-details.ts";

/*
 * Echtes Blatt für die Vorschau der Belegeditoren: dieselbe Vorlage und dieselben Daten wie beim PDF, aber aus dem
 * Stand des Formulars. Gespeichert wird nichts. Beim Tippen ist vieles noch unfertig, deshalb prüft das Schema weniger
 * als das Speichern; unvollständige Positionen lässt der Editor weg.
 */

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""));

export const documentPreviewSchema = z.object({
  kind: z.enum(["rechnung", "storno", "korrektur", "angebot"]),
  number: z.string().max(100),
  issueDate: date,
  dueDate: date,
  validUntil: date.nullable(),
  serviceFrom: date.nullable(),
  serviceTo: date.nullable(),
  // Beim Tippen steht hier auch „14 Tage“ oder „-“; dann zählt das Rechnungsdatum, wie im Editor
  paymentTermDays: z.number().int().min(0).max(1000).catch(0),
  contactId: z.uuid().nullable(),
  /** Ansprechpartner des Kunden (#424), für die Zeile „z. Hd.“ in der Vorschau */
  contactPersonId: z.uuid().nullable().default(null),
  ...referenceFieldsSchema,
  lines: z
    .array(
      z.object({
        description: z.string().max(500),
        detail: z.string().max(LINE_DETAIL_MAX).default(""),
        itemNumber: z.string().max(ITEM_NUMBER_MAX).default(""),
        // Ganzzahlig, aber ohne Vorzeichenprüfung: Abzüge der Schlussrechnung, Storno und Korrektur sind negativ
        quantity: z.number().int(),
        unit: z.string().max(20),
        unitPrice: z.number().int(),
        taxRate: z.number().int(),
        discount: z.nullable(discountSchema).default(null),
        kind: z.enum(QUOTE_LINE_KINDS).nullable().default(null),
        /** Abzug einer Abschlagsrechnung: zählt nicht zur Grundlage des Gesamtrabatts (discountBasis) */
        deductionOf: z.string().max(100).optional(),
      }),
    )
    .max(500),
  discount: z.nullable(discountSchema).default(null),
  plan: paymentPlanSchema,
  intro: z.string().max(4000),
  note: z.string().max(4000),
  propertyRetention: z.boolean().default(false),
  taxTreatment: z.enum(TAX_TREATMENT_KEYS),
  exemptionReason: z.string().max(600),
  // Unfertige Ortsangaben beim Tippen blockieren die reine Vorschau nicht; gespeichert wird hier nichts.
  taxDetails: outgoingTaxDetailsSchema.catch(null),
  priceMode: z.enum(["netto", "brutto"]),
  language: z.enum(["de", "en"]),
  variant: z.enum(["abschlag", "schluss"]).nullable(),
  corrects: z.object({ number: z.string().nullable(), issueDate: z.string() }).nullable(),
  currency: z.string().max(3),
  // Beim Tippen lässt der Editor auch Fristen über 120 Tage durch; solche Stufen fehlen auf dem Blatt, wie das Speichern sie ablehnt
  skonto: z
    .array(z.object({ days: z.number(), percent: z.number() }))
    .max(10)
    .transform((stufen) => stufen.filter((stufe) => skontoStufeSchema.safeParse(stufe).success)),
  sepaMandateId: z.uuid().nullable(),
  design: letterheadDesignInputSchema,
});

export type DocumentPreviewInput = z.input<typeof documentPreviewSchema>;
type Input = z.output<typeof documentPreviewSchema>;

export class DocumentPreviewError extends UserError {}

export interface DocumentPreview extends RenderedSheet {
  text: SheetTextPart[];
}

/** Ungespeicherte Gestaltung aus dem Panel über der gespeicherten */
function withDesign(letterhead: Letterhead, design: Input["design"]): Letterhead {
  const { accent, ...options } = design;
  return { ...letterhead, ...(accent ? { accent } : {}), options: { ...DEFAULT_OPTIONS, ...letterhead.options, ...options } };
}

async function previewBuyer(contactId: string | null, contactPersonId: string | null): Promise<Buyer> {
  const found = contactId ? await getContact(contactId) : null;
  // Die Vorschau zeigt „z. Hd.“ wie das spätere PDF: nur eine Person dieses Kunden, sonst keine Zeile
  const person =
    found && (await contactPersonProblem(db, found.contact.id, contactPersonId, contactPersonId)) === null
      ? await ansprechpartnerSnapshot(db, contactPersonId)
      : undefined;
  return found ? buyerFrom(found.contact, person) : { name: "[Kunde wählen]", strasse: "", plz: "", ort: "", land: "DE" };
}

function invoiceDocument(input: Input, company: Company, buyer: Buyer, letterhead: Letterhead, directDebit: InvoiceDocument["directDebit"]): InvoiceDocument {
  if (input.kind === "angebot") throw new DocumentPreviewError("Ein Angebot ist keine Rechnung.");
  const { lineNets, totals } = computeInvoice(input.lines, input.priceMode, input.discount);
  const treatment = input.taxTreatment;
  const { exemptionReason } = outgoingTaxColumns(input);
  return {
    ...letterhead,
    kind: input.kind,
    format: "zugferd",
    number: input.number,
    issueDate: input.issueDate,
    dueDate: input.dueDate || input.issueDate,
    paymentTermDays: input.paymentTermDays,
    ...(input.kind === "rechnung" && input.skonto.length > 0 ? { skonto: input.skonto } : {}),
    ...(input.serviceFrom ? { serviceFrom: input.serviceFrom } : {}),
    ...(input.serviceTo ? { serviceTo: input.serviceTo } : {}),
    currency: input.currency,
    seller: sellerFrom(company),
    buyer,
    lines: input.lines.map((line, index) => ({
      position: index + 1,
      description: line.description,
      ...(line.detail ? { detail: line.detail } : {}),
      ...(line.itemNumber ? { itemNumber: line.itemNumber } : {}),
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: lineNets[index]!,
      ...(line.discount ? { discount: line.discount } : {}),
      ...(line.deductionOf ? { deductionOf: line.deductionOf } : {}),
    })),
    totals,
    ...(input.discount ? { discount: input.discount } : {}),
    ...(input.corrects ? { corrects: { number: input.corrects.number ?? "–", issueDate: input.corrects.issueDate } } : {}),
    ...(input.intro ? { intro: input.intro } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.propertyRetention ? { propertyRetention: true } : {}),
    ...(treatment !== "regulaer" ? { taxTreatment: treatment } : {}),
    ...(input.priceMode === "brutto" ? { priceMode: input.priceMode } : {}),
    ...(exemptionReason ? { exemptionReason } : {}),
    language: input.language,
    ...(input.variant ? { variant: input.variant } : {}),
    ...documentReferences(referenceColumns(input)),
    ...(directDebit ? { directDebit } : {}),
  };
}

function quoteDocument(input: Input, company: Company, buyer: Buyer, letterhead: Letterhead): QuoteDocument {
  const { exemptionReason } = outgoingTaxColumns(input);
  const lines = input.lines.map((line, index) => ({ ...line, position: index + 1 }));
  const calc = quoteCalculation(lines, input.priceMode, input.discount);
  const paymentPlan = input.plan.length > 0 ? planSchedule(input.plan, orderRateAmounts(calc.totals, input.priceMode), input.priceMode) : [];
  return {
    ...letterhead,
    number: input.number,
    issueDate: input.issueDate,
    validUntil: input.validUntil || input.issueDate,
    ...(input.serviceFrom ? { serviceFrom: input.serviceFrom } : {}),
    ...(input.serviceTo ? { serviceTo: input.serviceTo } : {}),
    seller: sellerFrom(company),
    buyer,
    lines: lines.map((line, index) => ({
      position: line.position,
      description: line.description,
      ...(line.detail ? { detail: line.detail } : {}),
      ...(line.itemNumber ? { itemNumber: line.itemNumber } : {}),
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: calc.lineNets[index]!,
      ...(line.discount ? { discount: line.discount } : {}),
      ...(line.kind ? { kind: line.kind } : {}),
      ...(line.kind === "alternative" ? { alternativeTo: alternativeMain(lines, line.position) ?? 0 } : {}),
    })),
    totals: calc.totals,
    ...(input.discount ? { discount: input.discount } : {}),
    ...(paymentPlan.length > 0 ? { paymentPlan } : {}),
    ...(input.intro ? { intro: input.intro } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...documentReferences(referenceColumns(input)),
    ...(input.taxTreatment !== "regulaer" ? { taxTreatment: input.taxTreatment } : {}),
    ...(exemptionReason ? { exemptionReason } : {}),
    ...(input.priceMode === "brutto" ? { priceMode: input.priceMode } : {}),
    language: input.language,
  };
}

/** Das Blatt als SVG samt Text für Screenreader; statt des GiroCodes ein Platzhalter, damit niemand eine Vorschau bezahlt */
export async function documentPreview(input: Input): Promise<DocumentPreview> {
  const [company, stored, buyer] = await Promise.all([loadCompany(), loadLetterhead(), previewBuyer(input.contactId, input.contactPersonId)]);
  const letterhead = withDesign(stored, input.design);
  const dueDate = input.dueDate || input.issueDate;
  const directDebit = await directDebitFor(
    {
      kind: input.kind,
      contactId: input.contactId,
      currency: input.currency,
      dueDate,
      skonto: input.skonto,
      paymentMethod: input.sepaMandateId ? "lastschrift" : "ueberweisung",
      sepaMandateId: input.sepaMandateId,
    },
    company,
    db,
  );
  const t = texts(input.language, input.currency);
  const data =
    input.kind === "angebot"
      ? quotePdfData(quoteDocument(input, company, buyer, letterhead))
      : pdfData(invoiceDocument(input, company, buyer, letterhead, directDebit));
  const { draft: _noMark, ...sheet } = asDraft(data, t);
  // Mit eigenem Layout dasselbe wie beim Festschreiben: Quelltext aus der Datenbank, Daten wie für die eingebaute Vorlage
  const layout = await customLayoutFor(input.kind === "angebot" ? "angebot" : "rechnung");
  const job = layout
    ? await customLayoutJob(layout, dataForVersion(layout.schemaVersion, templateInputs(sheet, letterhead)), letterhead)
    : renderJob("rechnung.typ", sheet, letterhead);
  try {
    const renderer = layout ? await rendererFor(layout) : layoutRenderer;
    return { ...(await renderer.render(job)), text: sheetText(sheet as unknown as SheetData) };
  } catch (error) {
    if (layout) throw new DocumentPreviewError(`Das Layout „${layout.name}“ ließ sich nicht setzen: ${typstMeldung(error)}`);
    throw new DocumentPreviewError(
      `Die Vorschau ließ sich nicht erzeugen. ${error instanceof Error && error.message.includes("Zeitlimit") ? error.message : "Das PDF ist davon nicht betroffen."}`,
    );
  }
}
