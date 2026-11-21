import {
  computeInvoice,
  discountColumns,
  discountFromColumns,
  invoiceDueDate,
  invoiceEditProblem,
  sortSkonto,
  totalsFromTaxes,
  type InvoiceCalculation,
  type PriceMode,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { asc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { contactPersonProblem, contactRoleProblem, loadCompany, standardTexte, type Company, type RateFields } from "../stammdaten/index.ts";
import { deductionLinesFor, deductionProblems } from "./advance-deductions.ts";
import { lockInvoice } from "./advance-vat.ts";
import { attachmentFiles, removeFiles, unusedFiles } from "./attachments.ts";
import { draftRate, MAX_EURO_CENTS } from "./draft-rate.ts";
import { effectivePriceMode, type DraftInput, type LineInput } from "./draft-schema.ts";
import { InvoiceError } from "./invoice-error.ts";
import { euroTaxes, storeInvoiceTaxes } from "./invoice-taxes.ts";
import type { Invoice, InvoiceLine } from "./invoices.ts";
import { draftMandateProblem, paymentColumns } from "./lastschrift.ts";
import { customerChangeProblem } from "./leistungen-kunde.ts";
import { referenceColumns } from "./order-references.ts";
import { assertQuotesLocked, checkQuote, lockQuotes, quotesTouching, syncQuoteBilling } from "./quote-billing.ts";
import { defaultSkonto } from "./skonto.ts";
import { outgoingTaxColumns } from "./tax-details.ts";

/* Rechnungsentwürfe anlegen, ändern und löschen, samt Positionen, Summen und Steuerzeilen */

function lineRows(invoiceId: string, lines: LineInput[], lineNets: number[]) {
  return lines.map((line, index) => ({
    invoiceId,
    position: index + 1,
    description: line.description,
    detail: line.detail?.trim() ?? "",
    itemNumber: line.itemNumber?.trim() ?? "",
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNets[index]!,
    deductionOf: line.deductionOf ?? null,
    ...discountColumns(line.discount),
  }));
}

/**
 * Abzüge, die eine Korrektur aus der Schlussrechnung übernommen hat: Der Editor zeigt sie nur an, Haben behält sie beim
 * Speichern. So bleiben sie wie in der Schlussrechnung außerhalb der Grundlage des Gesamtrabatts (discountBasis).
 */
async function keptDeductions(tx: Tx, invoiceId: string): Promise<LineInput[]> {
  const rows = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLines.position));
  return rows.flatMap((line) => (line.deductionOf ? [{ ...lineInputOf(line), deductionOf: line.deductionOf }] : []));
}

/** Gespeicherte Position als Eingabe, mit Positionsrabatt */
export const lineInputOf = (line: InvoiceLine): LineInput => ({
  description: line.description,
  detail: line.detail,
  itemNumber: line.itemNumber,
  quantity: line.quantity,
  unit: line.unit as UnitLabel,
  unitPrice: line.unitPrice,
  taxRate: line.taxRate as 1900 | 700 | 0,
  discount: discountFromColumns(line.discountPercent, line.discountAmount),
});

/** Positionen und Steuerzeilen eines Entwurfs speichern, wie sie draftValues berechnet hat */
async function storeLines(tx: Tx, invoiceId: string, lines: LineInput[], { lineNets }: InvoiceCalculation, taxes: ReturnType<typeof euroTaxes>) {
  await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
  if (lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(invoiceId, lines, lineNets));
  await storeInvoiceTaxes(tx, invoiceId, taxes);
}

/** Positionen einer Rechnung samt Abzügen bei der Schlussrechnung; die Abschläge geprüft in der Transaktion, die speichert */
async function allLines(tx: Tx, invoiceId: string | null, input: DraftInput): Promise<LineInput[]> {
  if (input.variant !== "schluss") return input.lines;
  const { problems, chosen } = await deductionProblems(invoiceId, input, tx);
  if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
  return [...input.lines, ...deductionLinesFor(chosen, input.language ?? "de", input.taxTreatment ?? "regulaer", effectivePriceMode(input))];
}

/**
 * Felder eines Entwurfs samt Summen. Netto und Umsatzsteuer je Satz werden nur hier berechnet; danach
 * lesen alle anderen Stellen die gespeicherten Werte (invoice_taxes).
 */
function draftValues(input: DraftInput, bundesland: Company["bundesland"], lines: LineInput[], rate: { currency: string } & RateFields, kind = "rechnung") {
  const priceMode = effectivePriceMode(input);
  const calculation = computeInvoice(lines, priceMode, input.discount ?? null);
  // Gebucht wird in Euro: bei Fremdwährung je Satz mit dem Kurs umgerechnet
  const taxes = euroTaxes(calculation.totals.taxes, rate.currency, rate.exchangeRate);
  if (rate.currency !== "EUR" && taxes.some((t) => Math.abs(t.base) > MAX_EURO_CENTS || Math.abs(t.tax) > MAX_EURO_CENTS)) {
    throw new InvoiceError("Der umgerechnete Betrag ist zu groß. Stimmt der Kurs (1 EUR = … Fremdwährung)?");
  }
  const totals = totalsFromTaxes(taxes);
  const values = {
    contactId: input.contactId,
    contactPersonId: input.contactPersonId ?? null,
    issueDate: input.issueDate,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    paymentTermDays: input.paymentTermDays,
    dueDate: invoiceDueDate(input.issueDate, input.paymentTermDays, bundesland),
    skonto: input.paymentMethod === "bereits_bezahlt" ? [] : sortSkonto(input.skonto ?? []),
    format: input.format,
    intro: input.intro ?? "",
    note: input.note,
    propertyRetention: input.propertyRetention ?? false,
    ...referenceColumns(input),
    ...outgoingTaxColumns(input),
    priceMode,
    language: input.language ?? "de",
    variant: input.variant ?? null,
    advanceType: input.variant === "abschlag" ? (input.advanceType ?? "anzahlung") : null,
    quoteId: input.quoteId ?? null,
    ...discountColumns(input.discount),
    ...paymentColumns(input, kind),
    ...rate,
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
  return { values, calculation, taxes };
}

type DraftExtra = Partial<Pick<Invoice, "kind" | "correctsId" | "recurringId" | "recurringDate" | "externalSource" | "externalId" | "paymentPlanRow">>;

/** Rechnungen gehen an Kunden; ein Lieferant oder ein unbekannter Kontakt passt nicht */
export async function assertCustomer(tx: Tx, contactId: string | null | undefined) {
  if (!contactId) return;
  const problem = await contactRoleProblem(tx, contactId, "kunde");
  if (problem) throw new InvoiceError(problem);
}

export async function createDraft(actor: string, input: DraftInput, extra: DraftExtra = {}) {
  return withActor(actor, async (tx) => {
    // Storno, Korrektur und der Lauf einer Vorlage übernehmen den Kunden; gewählt wird er nur bei einer neuen Rechnung
    if (!extra.correctsId && !extra.recurringId) await assertCustomer(tx, input.contactId);
    return insertDraft(tx, input, extra);
  });
}

/** Legt einen Entwurf in einer laufenden Transaktion an, z. B. zusammen mit dem Festschreiben (Storno) */
export async function insertDraft(tx: Tx, input: DraftInput, extra: DraftExtra = {}): Promise<Invoice> {
  await lockQuotes(tx, input.quoteId ? [input.quoteId] : []);
  // Vor dem ersten Audit-Eintrag sperren: Der Fremdschlüssel der Abzugsposition braucht sonst erst danach den
  // Abschlag, während dessen parallele Zahlung auf die Audit-Kette wartet.
  for (const id of [...new Set([...(input.deducts ?? []), ...(extra.correctsId ? [extra.correctsId] : [])])].sort()) await lockInvoice(tx, id);
  const { bundesland } = await loadCompany(tx);
  await checkQuote(tx, input.quoteId);
  const lines = await allLines(tx, null, input);
  const { values, calculation, taxes } = draftValues(input, bundesland, lines, await draftRate(tx, input, extra.correctsId ?? null, null), extra.kind);
  const mandateProblem = await draftMandateProblem(tx, values, values.contactId, values.dueDate);
  if (mandateProblem) throw new InvoiceError(mandateProblem);
  const personProblem = await contactPersonProblem(tx, values.contactId, values.contactPersonId);
  if (personProblem) throw new InvoiceError(personProblem);
  const [invoice] = await tx
    .insert(schema.invoices)
    .values({ ...values, ...extra })
    .returning();
  await storeLines(tx, invoice!.id, lines, calculation, taxes);
  await syncQuoteBilling(tx, [invoice!.quoteId]);
  return invoice!;
}

export async function lockDraft(tx: Tx, id: string): Promise<Invoice> {
  const invoice = await lockInvoice(tx, id);
  if (!invoice) throw new InvoiceError("Rechnung nicht gefunden.");
  const problem = invoiceEditProblem(invoice);
  if (problem) throw new InvoiceError(problem);
  return invoice;
}

export async function updateDraft(actor: string, id: string, input: DraftInput) {
  return withActor(actor, async (tx) => {
    const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id], [input.quoteId]));
    const draft = await lockDraft(tx, id);
    for (const reference of [...new Set(input.deducts ?? [])].sort()) await lockInvoice(tx, reference);
    // Nur ein neuer Kunde wird geprüft: ein Kontakt, der inzwischen kein Kunde mehr ist, bleibt an der Rechnung
    if (input.contactId !== draft.contactId) {
      const entriesProblem = await customerChangeProblem(tx, id, input.contactId);
      if (entriesProblem) throw new InvoiceError(entriesProblem);
      await assertCustomer(tx, input.contactId);
    }
    await assertQuotesLocked(tx, quoteIds, [id], [input.quoteId]);
    const { bundesland } = await loadCompany(tx);
    if (draft.kind === "rechnung") await checkQuote(tx, input.quoteId);
    const lines = draft.kind === "rechnung" ? await allLines(tx, id, input) : [...input.lines, ...(await keptDeductions(tx, id))];
    if (input.variant && draft.kind !== "rechnung") throw new InvoiceError("Storno und Korrektur sind keine Abschlags- oder Schlussrechnung.");
    // Eine Korrektur rechnet wie die ursprüngliche Rechnung, netto oder brutto
    const rate = await draftRate(tx, input, draft.correctsId, draft);
    const { values, calculation, taxes } = draftValues(
      // Storno und Korrektur zahlt der Kunde nicht, also auch kein Skonto
      draft.kind === "rechnung" ? input : { ...input, priceMode: draft.priceMode, propertyRetention: draft.propertyRetention, quoteId: null, skonto: [] },
      bundesland,
      lines,
      rate,
      draft.kind,
    );
    const mandateProblem = await draftMandateProblem(tx, values, values.contactId, values.dueDate);
    if (mandateProblem) throw new InvoiceError(mandateProblem);
    // Die schon gewählte Person bleibt, auch wenn sie inzwischen deaktiviert ist; eine neue muss aktiv sein und zum Kunden gehören
    const personProblem = await contactPersonProblem(tx, values.contactId, values.contactPersonId, draft.contactPersonId);
    if (personProblem) throw new InvoiceError(personProblem);
    // Abschlag zu einer Zeile des Zahlungsplans: nur solange es ein Abschlag zu diesem Angebot bleibt
    const keepsPlanRow = values.variant === "abschlag" && values.quoteId === draft.quoteId;
    const [updated] = await tx
      .update(schema.invoices)
      .set({ ...values, ...(keepsPlanRow ? {} : { paymentPlanRow: null }) })
      .where(eq(schema.invoices.id, id))
      .returning();
    await storeLines(tx, id, lines, calculation, taxes);
    // Bezug oder Rechnungsart geändert: das bisherige und das neue Angebot neu bewerten
    await syncQuoteBilling(tx, quoteIds);
    return updated!;
  });
}

export async function deleteDraft(actor: string, id: string) {
  const unused = await withActor(actor, async (tx) => {
    const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id]));
    await lockDraft(tx, id);
    await assertQuotesLocked(tx, quoteIds, [id]);
    // Aus einem Angebot entstanden: das Angebot lässt sich danach wieder abrechnen
    await tx.update(schema.quotes).set({ invoiceId: null, updatedAt: new Date() }).where(eq(schema.quotes.invoiceId, id));
    const files = await attachmentFiles(tx, id);
    // Anhänge gehen mit der Rechnung (on delete cascade)
    await tx.delete(schema.invoices).where(eq(schema.invoices.id, id));
    await syncQuoteBilling(tx, quoteIds);
    return unusedFiles(tx, files);
  });
  await removeFiles(unused);
}

/** Neue Rechnung mit den Vorgaben aus den Firmendaten */
export async function newDraftDefaults(today: string) {
  // Standard-Textbausteine für Rechnungen (#1494): Kopftext als Einleitung, Fußtext als Hinweis
  const [company, standard] = await Promise.all([loadCompany(), standardTexte("rechnung")]);
  return {
    contactId: null,
    issueDate: today,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: company.paymentTermDays,
    skonto: defaultSkonto(company, null, company.paymentTermDays),
    format: company.defaultFormat,
    intro: standard.kopf,
    note: standard.fuss,
    propertyRetention: false,
    taxTreatment: (company.kleinunternehmer ? "kleinunternehmer" : "regulaer") as TaxTreatment,
    exemptionReason: "",
    priceMode: "netto" as PriceMode,
    language: "de" as const,
    variant: null,
    deducts: [] as string[],
    lines: [{ description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: (company.kleinunternehmer ? 0 : 1900) as 1900 | 0 }],
  } satisfies DraftInput;
}
