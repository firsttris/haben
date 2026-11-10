import { UserError } from "../../errors.ts";
import {
  addDays,
  alternativeMain,
  chosenLines,
  computeInvoice,
  countsInTotal,
  discountColumns,
  discountFromColumns,
  discountSchema,
  discountedLineAmount,
  documentDiscountProblem,
  lineAmount,
  lineDiscountProblem,
  netOf,
  orderRateAmounts,
  paymentPlanSchema,
  planProblem,
  planSchedule,
  quoteLineKindProblem,
  type Discount,
  type InvoiceCalculation,
  type QuoteLineKind,
  PRICE_MODES,
  QUOTE_VALID_DAYS,
  TAX_TREATMENT_KEYS,
  type PriceMode,
  type TaxTreatment,
  type UnitLabel,
  quoteDecisionProblem,
  quoteEditProblem,
  quoteInvoiceProblem,
  quoteStatus as coreQuoteStatus,
  type QuoteListStatus,
} from "@haben/core";
import { buildQuotePdf, texts, type QuoteDocument, type QuoteDocumentLine } from "@haben/einvoice";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany, sellerIssues } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadLetterhead } from "../stammdaten/index.ts";
import { circleFor, documentNumber, peekNumber, takeNumber } from "./number-counter.ts";
import { quoteDraftLineSchema } from "./draft-line.ts";
import { buyerFrom, effectivePriceMode, insertDraft, invoiceDiscountOf, lineDiscountOf, openAbschlaege, sellerFrom, type Invoice } from "./invoices.ts";
import { removeFiles, unusedFiles } from "./attachment-store.ts";
import { attachStoredToQuote, copyQuoteAttachments, quoteAttachmentFiles } from "./quote-attachments.ts";
import { listQuoteDefaultAttachments } from "./quote-default-attachments.ts";
import { quoteChoices, storeQuoteChoices } from "./quote-choices.ts";
import { documentReferences, referenceColumns, referenceFieldsSchema, referencesFromQuote } from "./order-references.ts";
import { defaultSkonto } from "./skonto.ts";

/**
 * Angebote: eigener Nummernkreis (AN-2026-001), PDF mit der Rechnungsvorlage, keine Buchung.
 * Ein festgeschriebenes Angebot bleibt unverändert (Handelsbrief, § 257 HGB); aus ihm entsteht
 * auf Wunsch ein Rechnungsentwurf mit denselben Positionen.
 */

export type Quote = typeof schema.quotes.$inferSelect;
export type QuoteLine = typeof schema.quoteLines.$inferSelect;

export class QuoteError extends UserError {}

const isoDate = z.iso.date();

export const quoteDraftSchema = z
  .object({
    contactId: z.uuid().nullable(),
    issueDate: isoDate,
    validUntil: isoDate,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    /** Einleitung über den Positionen, etwa aus einem Textbaustein */
    intro: z.string().max(2000).default(""),
    note: z.string().max(2000),
    /** Bestellnummer des Kunden, eigene Auftragsnummer und Lieferschein; gehen in die Rechnung aus dem Angebot über */
    ...referenceFieldsSchema,
    taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
    exemptionReason: z.string().trim().max(300).default(""),
    /** Einzelpreise netto oder brutto inkl. USt; brutto nur bei regulärer Besteuerung */
    priceMode: z.enum(PRICE_MODES).default("netto"),
    /** Sprache des PDFs für den Kunden */
    language: z.enum(["de", "en"]).default("de"),
    lines: z.array(quoteDraftLineSchema).max(200),
    /** Gesamtrabatt auf die Positionen, die zählen; null = keiner */
    discount: z.nullable(discountSchema).default(null),
    /** Zahlungsplan: Prozent, fester Betrag im Preismodus oder Rest je Zeile; leer = keiner */
    paymentPlan: z._default(paymentPlanSchema, []),
    /** Zahlungsplan auch in der Auftragsbestätigung */
    paymentPlanInConfirmation: z.boolean().default(false),
  })
  .refine((d) => d.validUntil >= d.issueDate, { message: "Das Angebot muss mindestens bis zum Angebotsdatum gelten", path: ["validUntil"] })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  })
  .superRefine((d, ctx) => {
    const lines = d.lines.map((line, i) => ({ ...line, position: i + 1 }));
    lines.forEach((line, i) => {
      const problem = lineDiscountProblem(line);
      if (problem) ctx.addIssue({ code: "custom", message: `Position ${i + 1}: ${problem}`, path: ["lines", i, "discount"] });
    });
    const kindProblem = quoteLineKindProblem(lines);
    if (kindProblem) ctx.addIssue({ code: "custom", message: kindProblem, path: ["lines"] });
    const counted = lines.filter(countsInTotal);
    const discountProblem = documentDiscountProblem(counted, d.discount);
    if (discountProblem) ctx.addIssue({ code: "custom", message: discountProblem, path: ["discount"] });
    if (kindProblem || discountProblem) return;
    const priceMode = effectivePriceMode(d);
    const { totals } = computeInvoice(counted, priceMode, d.discount);
    const problem = planProblem(
      d.paymentPlan,
      orderRateAmounts(totals, priceMode).reduce((s, a) => s + a.amount, 0),
    );
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["paymentPlan"] });
  });

export type QuoteDraftInput = z.input<typeof quoteDraftSchema>;

export type { QuoteListStatus };

/** Positionen einer Abschlagsrechnung aus einer Zeile des Zahlungsplans, mit der Zeile (quote-plan.ts) */
export interface AbschlagPlanLines {
  row: number;
  lines: { description: string; quantity: number; unit: UnitLabel; unitPrice: number; taxRate: 1900 | 700 | 0 }[];
}

/** Berechnet die Positionen in der Transaktion, die das Angebot gesperrt hat, nach der Auswahl des Kunden */
export type PlanLinesFor = (tx: Tx, quote: Quote, lines: QuoteLine[], choices: number[]) => Promise<AbschlagPlanLines>;

type CalcLine = Parameters<typeof computeInvoice>[0][number] & { kind?: QuoteLineKind | null };

/**
 * Summen eines Angebots aus den Positionen, die zählen, mit Positions- und Gesamtrabatt; optionale und alternative
 * Positionen haben ihr Netto für sich (ohne Gesamtrabatt), denn sie stehen nur zur Wahl.
 */
export function quoteCalculation(lines: CalcLine[], priceMode: "netto" | "brutto", discount: Discount | null): InvoiceCalculation {
  const counted = lines.filter((l) => countsInTotal({ kind: l.kind ?? null }));
  const calc = computeInvoice(counted, priceMode, discount);
  let next = 0;
  const lineNets = lines.map((line) =>
    countsInTotal({ kind: line.kind ?? null }) ? calc.lineNets[next++]! : netOf(discountedLineAmount(line), line.taxRate, priceMode),
  );
  return { ...calc, lineNets, lineAmounts: lines.map((l) => discountedLineAmount(l)) };
}

function lineRows(quoteId: string, input: QuoteDraftInput) {
  const { lineNets } = quoteCalculation(input.lines, effectivePriceMode(input), input.discount ?? null);
  return input.lines.map((line, index) => ({
    quoteId,
    position: index + 1,
    description: line.description,
    detail: line.detail?.trim() ?? "",
    itemNumber: line.itemNumber?.trim() ?? "",
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNets[index]!,
    ...discountColumns(line.discount),
    kind: line.kind ?? null,
  }));
}

function draftValues(input: QuoteDraftInput) {
  const priceMode = effectivePriceMode(input);
  const { totals } = quoteCalculation(input.lines, priceMode, input.discount ?? null);
  const treatment = input.taxTreatment ?? "regulaer";
  return {
    contactId: input.contactId,
    issueDate: input.issueDate,
    validUntil: input.validUntil,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    intro: input.intro ?? "",
    note: input.note,
    ...referenceColumns(input),
    taxTreatment: treatment,
    exemptionReason: treatment !== "regulaer" ? (input.exemptionReason ?? "").trim() : "",
    priceMode,
    language: input.language ?? "de",
    ...discountColumns(input.discount),
    paymentPlan: input.paymentPlan ?? [],
    paymentPlanInConfirmation: (input.paymentPlan ?? []).length > 0 && (input.paymentPlanInConfirmation ?? false),
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
}

/** Legt den Entwurf an; parsed ist schon durch quoteDraftSchema gelaufen */
async function insertQuoteDraft(tx: Tx, parsed: z.output<typeof quoteDraftSchema>): Promise<Quote> {
  const [quote] = await tx.insert(schema.quotes).values(draftValues(parsed)).returning();
  if (parsed.lines.length > 0) await tx.insert(schema.quoteLines).values(lineRows(quote!.id, parsed));
  return quote!;
}

/** Neuer Entwurf; er bekommt die Standardanhänge aus den Einstellungen (#415) als eigene Anhänge */
export async function createQuoteDraft(actor: string, input: QuoteDraftInput): Promise<Quote> {
  const parsed = quoteDraftSchema.parse(input);
  return withActor(actor, async (tx) => {
    const quote = await insertQuoteDraft(tx, parsed);
    // Mit ihrem Zeitpunkt aus den Einstellungen, wie beim Kopieren: so bleibt deren Reihenfolge
    await attachStoredToQuote(tx, quote.id, await listQuoteDefaultAttachments(tx));
    return quote;
  });
}

/** Sperrt den Entwurf für die Transaktion; auch für seine Anhänge (quote-attachments.ts) */
export async function lockDraft(tx: Tx, id: string): Promise<Quote> {
  const [quote] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, id)).for("update");
  if (!quote) throw new QuoteError("Angebot nicht gefunden.");
  const problem = quoteEditProblem(quote);
  if (problem) throw new QuoteError(problem);
  return quote;
}

export async function updateQuoteDraft(actor: string, id: string, input: QuoteDraftInput): Promise<Quote> {
  const parsed = quoteDraftSchema.parse(input);
  return withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id));
    if (parsed.lines.length > 0) await tx.insert(schema.quoteLines).values(lineRows(id, parsed));
    const [updated] = await tx.update(schema.quotes).set(draftValues(parsed)).where(eq(schema.quotes.id, id)).returning();
    return updated!;
  });
}

export async function deleteQuoteDraft(actor: string, id: string): Promise<void> {
  const unused = await withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    const files = await quoteAttachmentFiles(tx, id);
    // Anhänge gehen mit dem Angebot (on delete cascade), ihre Dateien, sobald sie sonst niemand nutzt
    await tx.delete(schema.quotes).where(eq(schema.quotes.id, id));
    return unusedFiles(tx, files);
  });
  await removeFiles(unused);
}

/** Neues Angebot mit den Vorgaben aus den Firmendaten */
export async function newQuoteDefaults(today: string) {
  const company = await loadCompany();
  return {
    contactId: null,
    issueDate: today,
    validUntil: addDays(today, QUOTE_VALID_DAYS),
    serviceFrom: null,
    serviceTo: null,
    intro: company.quoteIntro,
    note: "",
    taxTreatment: (company.kleinunternehmer ? "kleinunternehmer" : "regulaer") as TaxTreatment,
    exemptionReason: "",
    priceMode: "netto" as PriceMode,
    language: "de" as const,
    lines: [{ description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: (company.kleinunternehmer ? 0 : 1900) as 1900 | 0 }],
    discount: null,
    paymentPlan: [],
    paymentPlanInConfirmation: false,
  } satisfies QuoteDraftInput;
}

export async function getQuote(id: string, q: Db | Tx = db) {
  const [quote] = await q.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!quote) return null;
  const lines = await q.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
  const [contact] = quote.contactId ? await q.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId)) : [];
  const [invoice] = quote.invoiceId
    ? await q
        .select({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, quote.invoiceId))
    : [];
  return {
    quote,
    lines,
    contact: contact ?? null,
    invoice: invoice ?? null,
    billing: await quoteBilling(id, quote.invoiceId, q),
    choices: await quoteChoices(id, q),
  };
}

/**
 * Rechnungen zu einem Angebot: Abschläge, Schlussrechnung und die Rechnung aus dem Angebot (auch ältere, die nur über
 * quotes.invoice_id verknüpft sind), mit Stornostatus
 */
async function quoteBilling(quoteId: string, invoiceId: string | null, q: Db | Tx = db) {
  const rows = await q
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      status: schema.invoices.status,
      variant: schema.invoices.variant,
      paymentPlanRow: schema.invoices.paymentPlanRow,
      issueDate: schema.invoices.issueDate,
      gross: schema.invoices.gross,
      cancelled: sql<boolean>`exists (select 1 from invoices s where s.corrects_id = ${schema.invoices.id} and s.kind = 'storno' and s.status = 'final')`,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.kind, "rechnung"),
        invoiceId ? or(eq(schema.invoices.quoteId, quoteId), eq(schema.invoices.id, invoiceId)) : eq(schema.invoices.quoteId, quoteId),
      ),
    )
    .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.createdAt));
  return rows;
}

/** Status für die Liste; Regeln in @haben/core (lebenszyklus.ts) */
export function quoteStatus(quote: Pick<Quote, "status" | "decision" | "invoiceId" | "validUntil">, today: string): QuoteListStatus {
  return coreQuoteStatus(quote, today);
}

export async function listQuotes(today: string) {
  const rows = await db
    .select({
      id: schema.quotes.id,
      status: schema.quotes.status,
      number: schema.quotes.number,
      issueDate: schema.quotes.issueDate,
      validUntil: schema.quotes.validUntil,
      net: schema.quotes.net,
      gross: schema.quotes.gross,
      decision: schema.quotes.decision,
      invoiceId: schema.quotes.invoiceId,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.quotes.buyer} ->> 'name'`,
    })
    .from(schema.quotes)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.quotes.contactId))
    .orderBy(sql`${schema.quotes.number} desc nulls first`, desc(schema.quotes.createdAt));
  return rows.map((row) => ({ ...row, customer: row.buyerName ?? row.contactName ?? "–", listStatus: quoteStatus(row, today) }));
}

/** Positionen in der Form, die computeInvoice und quoteCalculation lesen */
export const calcLines = (lines: QuoteLine[]) =>
  lines.map((line) => ({
    ...line,
    taxRate: line.taxRate as 1900 | 700 | 0,
    discount: discountFromColumns(line.discountPercent, line.discountAmount),
  }));

/**
 * Auftrag nach der Auswahl des Kunden: gewählte optionale und alternative Positionen statt der Hauptpositionen, als normale
 * Positionen; ohne Auswahl die Hauptpositionen. Grundlage für Rechnung, Abschläge, Zahlungsplan und Auftragsbestätigung.
 */
export function orderLines(lines: QuoteLine[], choices: number[]): QuoteLine[] {
  return chosenLines(lines, choices).map((line) => ({ ...line, kind: null }));
}

/** Summen des Auftrags nach der Auswahl, mit den Rabatten des Angebots */
export function orderCalculation(quote: Quote, lines: QuoteLine[], choices: number[]): InvoiceCalculation {
  return computeInvoice(calcLines(orderLines(lines, choices)), quote.priceMode, discountFromColumns(quote.discountPercent, quote.discountAmount));
}

/**
 * Angebot bzw. Auftragsbestätigung als Dokument. Ohne `choices` das Angebot mit allen Positionen (optionale und
 * alternative gekennzeichnet), mit `choices` der Auftrag nach der Auswahl, fortlaufend nummeriert. Der Zahlungsplan steht
 * im Angebot immer, in der Auftragsbestätigung nur auf Wunsch (`withPlan`).
 */
export function quoteDocumentFor(
  quote: Quote,
  allLines: QuoteLine[],
  seller: QuoteDocument["seller"],
  buyer: QuoteDocument["buyer"],
  number: string,
  order: { choices: number[]; withPlan: boolean } | null = null,
): QuoteDocument {
  const lines = order ? orderLines(allLines, order.choices).map((line, i) => ({ ...line, position: i + 1 })) : allLines;
  const discount = discountFromColumns(quote.discountPercent, quote.discountAmount);
  const calc = quoteCalculation(calcLines(lines), quote.priceMode, discount);
  const withPlan = quote.paymentPlan.length > 0 && (!order || order.withPlan);
  return {
    number,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    ...(quote.serviceFrom ? { serviceFrom: quote.serviceFrom } : {}),
    ...(quote.serviceTo ? { serviceTo: quote.serviceTo } : {}),
    seller,
    buyer,
    lines: lines.map(
      (line, i): QuoteDocumentLine => ({
        position: line.position,
        description: line.description,
        ...(line.detail ? { detail: line.detail } : {}),
        ...(line.itemNumber ? { itemNumber: line.itemNumber } : {}),
        quantity: line.quantity,
        unit: line.unit as UnitLabel,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        net: calc.lineNets[i]!,
        ...lineDiscountOf(line),
        ...(line.kind ? { kind: line.kind } : {}),
        ...(line.kind === "alternative" ? { alternativeTo: alternativeMain(lines, line.position) ?? 0 } : {}),
      }),
    ),
    totals: calc.totals,
    ...(discount ? { discount } : {}),
    ...(withPlan ? { paymentPlan: planSchedule(quote.paymentPlan, orderRateAmounts(calc.totals, quote.priceMode), quote.priceMode) } : {}),
    ...(quote.intro ? { intro: quote.intro } : {}),
    ...(quote.note ? { note: quote.note } : {}),
    ...documentReferences(quote),
    ...(quote.taxTreatment !== "regulaer" ? { taxTreatment: quote.taxTreatment } : {}),
    ...(quote.exemptionReason ? { exemptionReason: quote.exemptionReason } : {}),
    ...(quote.priceMode === "brutto" ? { priceMode: quote.priceMode } : {}),
    language: quote.language,
  };
}

/** Was vor dem Festschreiben fehlt; leere Liste = bereit */
export async function quoteIssues(id: string): Promise<string[]> {
  const data = await getQuote(id);
  if (!data) return ["Angebot nicht gefunden"];
  const { quote, lines, contact } = data;
  const company = await loadCompany();
  const issues = sellerIssues(company).map((issue) => `Firmendaten: ${issue}`);
  if (company.kleinunternehmer && quote.taxTreatment !== "kleinunternehmer") issues.push("Als Kleinunternehmer bietest du ohne Umsatzsteuer an (§ 19 UStG)");
  if (!company.kleinunternehmer && quote.taxTreatment === "kleinunternehmer") issues.push("Kleinunternehmer ist in den Einstellungen nicht eingeschaltet");
  if (quote.taxTreatment === "steuerfrei" && !quote.exemptionReason) issues.push("Befreiungsvorschrift fehlt");
  if (!contact) issues.push("Kunde fehlt");
  if (lines.length === 0) issues.push("Keine Positionen");
  if (lines.some((line) => lineAmount(line.quantity, line.unitPrice) === 0)) issues.push("Position ohne Betrag");
  if (quote.gross <= 0) issues.push("Angebotssumme muss positiv sein");
  const kindProblem = quoteLineKindProblem(lines);
  if (kindProblem) issues.push(kindProblem);
  const planIssue = planProblem(quote.paymentPlan, quote.priceMode === "brutto" ? quote.gross : quote.net);
  if (planIssue) issues.push(planIssue);
  return issues;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Festschreiben: Nummer ziehen, PDF erzeugen, sperren – in einer Transaktion, ohne Lücke bei Fehlern */
export async function finalizeQuote(actor: string, id: string): Promise<Quote> {
  const issues = await quoteIssues(id);
  if (issues.length > 0) throw new QuoteError(`Noch nicht bereit: ${issues.join(", ")}.`);
  return withActor(actor, async (tx) => {
    const quote = await lockDraft(tx, id);
    const company = await loadCompany(tx);
    const lines = await tx.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
    const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId!));
    // Wie bei Rechnungen: Nummer lesen, PDF erzeugen, erst dann schreiben (number-counter.ts)
    const circle = await circleFor(tx, "angebot", quote.issueDate);
    const counter = await peekNumber(tx, "angebot", circle);
    const number = await documentNumber(tx, "angebot", company.quoteNumberFormat, quote.issueDate, counter);
    const seller = sellerFrom(company);
    const buyer = buyerFrom(contact!);
    const doc = quoteDocumentFor(quote, lines, seller, buyer, number);
    const pdf = buildQuotePdf({ ...doc, ...(await loadLetterhead()) });
    const now = new Date();
    await takeNumber(tx, "angebot", circle, counter);
    const [finalized] = await tx
      .update(schema.quotes)
      .set({
        status: "final",
        number,
        numberYear: circle,
        numberCounter: counter,
        contactVersion: contact!.version,
        seller,
        buyer,
        net: doc.totals.net,
        tax: doc.totals.tax,
        gross: doc.totals.gross,
        pdf: Buffer.from(pdf),
        pdfSha256: sha256(pdf),
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.quotes.id, id))
      .returning();
    return finalized!;
  });
}

async function lockQuote(tx: Tx, id: string): Promise<Quote> {
  const [quote] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, id)).for("update");
  if (!quote) throw new QuoteError("Angebot nicht gefunden.");
  return quote;
}

/**
 * Antwort des Kunden festhalten oder zurücknehmen; nicht mehr, sobald eine Rechnung daraus entstanden ist. Mit der Annahme
 * die Auswahl optionaler und alternativer Positionen (`choices`, Positionsnummern), ohne Annahme fällt sie weg.
 */
export async function setQuoteDecision(actor: string, id: string, decision: "angenommen" | "abgelehnt" | null, choices: number[] | null = null): Promise<void> {
  await withActor(actor, async (tx) => {
    const quote = await lockQuote(tx, id);
    const problem = quoteDecisionProblem(quote);
    if (problem) throw new QuoteError(problem);
    await tx
      .update(schema.quotes)
      .set({ decision, decidedAt: decision ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.quotes.id, id));
    if (decision !== "angenommen") await storeQuoteChoices(tx, id, []);
    else if (choices) await storeQuoteChoices(tx, id, choices);
  });
}

/**
 * Rechnungsentwurf aus dem Angebot: Kunde, Positionen, Leistungszeitraum und Umsatzsteuer übernommen,
 * Datum heute, Zahlungsziel, Skonto und Format wie bei neuen Rechnungen. Das Angebot gilt damit als angenommen.
 * Entwurf und Verknüpfung entstehen in einer Transaktion mit gesperrtem Angebot.
 *
 * - `abschlag`: Abschlagsrechnung mit einer Position „Abschlag gemäß Angebot …“, den Betrag trägst du ein. Das Angebot
 *   bleibt offen für weitere Abschläge und die Schlussrechnung.
 * - `schluss`: Schlussrechnung mit allen Positionen; abgezogen werden die festgeschriebenen Abschläge dieses Angebots.
 */
export async function quoteToInvoice(
  actor: string,
  id: string,
  today: string,
  variant: "abschlag" | "schluss" | null = null,
  options: { choices?: number[] | null; planLines?: PlanLinesFor } = {},
): Promise<Invoice> {
  return withActor(actor, async (tx) => {
    const locked = await lockQuote(tx, id);
    const problem = quoteInvoiceProblem(locked);
    if (problem) throw new QuoteError(problem);
    // Auswahl des Kunden zuerst festhalten: Rechnung, Abschläge und Auftragsbestätigung beruhen auf ihr
    if (options.choices) await storeQuoteChoices(tx, id, options.choices);
    const { lines: allLines, contact, choices } = (await getQuote(id, tx))!;
    const lines = orderLines(allLines, choices);
    const company = await loadCompany(tx);
    const t = texts(locked.language);
    const planned = variant === "abschlag" && options.planLines ? await options.planLines(tx, locked, allLines, choices) : null;
    // Abschlag: eine Position zum Steuersatz mit dem größten Anteil am Angebot, Betrag offen
    const mainRate = lines.reduce<{ rate: number; amount: number } | null>((best, line) => {
      const amount = Math.abs(line.quantity * line.unitPrice);
      return !best || amount > best.amount ? { rate: line.taxRate, amount } : best;
    }, null)?.rate;
    const abschlagLine = {
      description: t.abschlagFromQuote(locked.number ?? "", t.date(locked.issueDate)),
      quantity: 1000,
      unit: "Psch." as UnitLabel,
      unitPrice: 0,
      taxRate: (mainRate ?? 0) as 1900 | 700 | 0,
    };
    const deducts =
      variant === "schluss"
        ? (await openAbschlaege(null, tx))
            .filter((a) => a.quoteId === id && a.contactId === locked.contactId && a.taxTreatment === locked.taxTreatment)
            .map((a) => a.id)
        : [];
    const invoice = await insertDraft(
      tx,
      {
        contactId: locked.contactId,
        issueDate: today,
        serviceFrom: locked.serviceFrom,
        serviceTo: locked.serviceTo,
        paymentTermDays: company.paymentTermDays,
        skonto: defaultSkonto(company, contact, company.paymentTermDays),
        format: contact?.defaultFormat ?? (contact?.leitwegId ? "xrechnung-cii" : company.defaultFormat),
        intro: locked.intro,
        note: texts(locked.language).fromQuote(locked.number ?? "", texts(locked.language).date(locked.issueDate)),
        ...referencesFromQuote(locked),
        taxTreatment: locked.taxTreatment,
        exemptionReason: locked.exemptionReason,
        priceMode: locked.priceMode,
        language: locked.language,
        variant,
        deducts,
        quoteId: id,
        // Der Abschlag ist schon rabattiert berechnet; Rechnung und Schlussrechnung übernehmen die Rabatte des Angebots
        ...(variant === "abschlag" ? {} : invoiceDiscountOf(locked)),
        lines:
          variant === "abschlag"
            ? (planned?.lines ?? [abschlagLine])
            : lines.map((line) => ({
                description: line.description,
                detail: line.detail,
                itemNumber: line.itemNumber,
                quantity: line.quantity,
                unit: line.unit as UnitLabel,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate as 1900 | 700 | 0,
                ...lineDiscountOf(line),
              })),
      },
      planned ? { paymentPlanRow: planned.row } : {},
    );
    // invoice_id setzt insertDraft (syncQuoteBilling): ein Abschlag rechnet das Angebot noch nicht ab, erst die Schlussrechnung
    // bzw. die Rechnung über alles
    await tx
      .update(schema.quotes)
      .set({ decision: "angenommen", decidedAt: locked.decidedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(schema.quotes.id, id));
    return invoice;
  });
}

/** Neuer Entwurf mit Kunde, Positionen und Anhängen eines vorhandenen Angebots, Datum und Gültigkeit neu */
export async function copyQuote(actor: string, id: string, today: string): Promise<Quote> {
  const data = await getQuote(id);
  if (!data) throw new QuoteError("Angebot nicht gefunden.");
  const { quote, lines } = data;
  const validDays = Math.max(0, Math.round((Date.parse(quote.validUntil) - Date.parse(quote.issueDate)) / 86_400_000));
  const input: QuoteDraftInput = {
    contactId: quote.contactId,
    issueDate: today,
    validUntil: addDays(today, validDays || QUOTE_VALID_DAYS),
    serviceFrom: null,
    serviceTo: null,
    intro: quote.intro,
    note: quote.note,
    ...referenceColumns(quote),
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    priceMode: quote.priceMode,
    language: quote.language,
    discount: discountFromColumns(quote.discountPercent, quote.discountAmount),
    paymentPlan: quote.paymentPlan,
    paymentPlanInConfirmation: quote.paymentPlanInConfirmation,
    lines: lines.map((line) => ({
      description: line.description,
      detail: line.detail,
      itemNumber: line.itemNumber,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate as 1900 | 700 | 0,
      kind: line.kind,
      ...lineDiscountOf(line),
    })),
  };
  const parsed = quoteDraftSchema.parse(input);
  return withActor(actor, async (tx) => {
    const copy = await insertQuoteDraft(tx, parsed);
    await copyQuoteAttachments(tx, id, copy.id);
    return copy;
  });
}

export async function loadQuotePdf(id: string) {
  const [row] = await db.select({ pdf: schema.quotes.pdf, number: schema.quotes.number }).from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!row?.pdf || !row.number) return null;
  return { pdf: row.pdf, filename: `Angebot-${row.number}.pdf` };
}
