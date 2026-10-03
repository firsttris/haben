import {
  addDays,
  computeInvoiceTotals,
  formatQuoteNumber,
  invoiceLineInputSchema,
  lineNet,
  QUOTE_VALID_DAYS,
  TAX_TREATMENT_KEYS,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { buildQuotePdf, type QuoteDocument } from "@haben/einvoice";
import { asc, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany, sellerIssues } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";
import { buyerFrom, createDraft, deleteDraft, sellerFrom, type Invoice } from "./invoices.ts";

/**
 * Angebote: eigener Nummernkreis (AN-2026-001), PDF mit der Rechnungsvorlage, keine Buchung.
 * Ein festgeschriebenes Angebot bleibt unverändert (Handelsbrief, § 257 HGB); aus ihm entsteht
 * auf Wunsch ein Rechnungsentwurf mit denselben Positionen.
 */

export type Quote = typeof schema.quotes.$inferSelect;
export type QuoteLine = typeof schema.quoteLines.$inferSelect;

export class QuoteError extends Error {}

const isoDate = z.iso.date();

export const quoteDraftSchema = z
  .object({
    contactId: z.uuid().nullable(),
    issueDate: isoDate,
    validUntil: isoDate,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    note: z.string().max(2000),
    taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
    exemptionReason: z.string().trim().max(300).default(""),
    lines: z.array(invoiceLineInputSchema).max(200),
  })
  .refine((d) => d.validUntil >= d.issueDate, { message: "Das Angebot muss mindestens bis zum Angebotsdatum gelten", path: ["validUntil"] })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  });

export type QuoteDraftInput = z.input<typeof quoteDraftSchema>;

export type QuoteListStatus = "entwurf" | "offen" | "abgelaufen" | "angenommen" | "abgelehnt" | "abgerechnet";

function lineRows(quoteId: string, lines: QuoteDraftInput["lines"]) {
  return lines.map((line, index) => ({
    quoteId,
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNet(line.quantity, line.unitPrice),
  }));
}

function draftValues(input: QuoteDraftInput) {
  const totals = computeInvoiceTotals(input.lines);
  const treatment = input.taxTreatment ?? "regulaer";
  return {
    contactId: input.contactId,
    issueDate: input.issueDate,
    validUntil: input.validUntil,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    note: input.note,
    taxTreatment: treatment,
    exemptionReason: treatment !== "regulaer" ? (input.exemptionReason ?? "").trim() : "",
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
}

export async function createQuoteDraft(actor: string, input: QuoteDraftInput): Promise<Quote> {
  const parsed = quoteDraftSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [quote] = await tx.insert(schema.quotes).values(draftValues(parsed)).returning();
    if (parsed.lines.length > 0) await tx.insert(schema.quoteLines).values(lineRows(quote!.id, parsed.lines));
    return quote!;
  });
}

async function lockDraft(tx: Tx, id: string): Promise<Quote> {
  const [quote] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, id)).for("update");
  if (!quote) throw new QuoteError("Angebot nicht gefunden.");
  if (quote.status !== "draft") throw new QuoteError("Das Angebot ist festgeschrieben und kann nicht mehr geändert werden.");
  return quote;
}

export async function updateQuoteDraft(actor: string, id: string, input: QuoteDraftInput): Promise<Quote> {
  const parsed = quoteDraftSchema.parse(input);
  return withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id));
    if (parsed.lines.length > 0) await tx.insert(schema.quoteLines).values(lineRows(id, parsed.lines));
    const [updated] = await tx.update(schema.quotes).set(draftValues(parsed)).where(eq(schema.quotes.id, id)).returning();
    return updated!;
  });
}

export async function deleteQuoteDraft(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(schema.quotes).where(eq(schema.quotes.id, id));
  });
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
    note: "",
    taxTreatment: (company.kleinunternehmer ? "kleinunternehmer" : "regulaer") as TaxTreatment,
    exemptionReason: "",
    lines: [
      { description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: (company.kleinunternehmer ? 0 : 1900) as 1900 | 0 },
    ],
  } satisfies QuoteDraftInput;
}

export async function getQuote(id: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!quote) return null;
  const lines = await db.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
  const [contact] = quote.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId)) : [];
  const [invoice] = quote.invoiceId
    ? await db
        .select({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, quote.invoiceId))
    : [];
  return { quote, lines, contact: contact ?? null, invoice: invoice ?? null };
}

export function quoteStatus(quote: Pick<Quote, "status" | "decision" | "invoiceId" | "validUntil">, today: string): QuoteListStatus {
  if (quote.status === "draft") return "entwurf";
  if (quote.invoiceId) return "abgerechnet";
  if (quote.decision) return quote.decision;
  return quote.validUntil < today ? "abgelaufen" : "offen";
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

function documentFor(quote: Quote, lines: QuoteLine[], seller: QuoteDocument["seller"], buyer: QuoteDocument["buyer"], number: string): QuoteDocument {
  return {
    number,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    ...(quote.serviceFrom ? { serviceFrom: quote.serviceFrom } : {}),
    ...(quote.serviceTo ? { serviceTo: quote.serviceTo } : {}),
    seller,
    buyer,
    lines: lines.map((line) => ({
      position: line.position,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: line.net,
    })),
    totals: computeInvoiceTotals(lines.map((line) => ({ ...line, taxRate: line.taxRate as 1900 | 700 | 0 }))),
    ...(quote.note ? { note: quote.note } : {}),
    ...(quote.taxTreatment !== "regulaer" ? { taxTreatment: quote.taxTreatment } : {}),
    ...(quote.exemptionReason ? { exemptionReason: quote.exemptionReason } : {}),
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
  if (lines.some((line) => line.net === 0)) issues.push("Position ohne Betrag");
  if (quote.gross <= 0) issues.push("Angebotssumme muss positiv sein");
  return issues;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Festschreiben: Nummer ziehen, PDF erzeugen, sperren – in einer Transaktion, ohne Lücke bei Fehlern */
export async function finalizeQuote(actor: string, id: string): Promise<Quote> {
  const issues = await quoteIssues(id);
  if (issues.length > 0) throw new QuoteError(`Noch nicht bereit: ${issues.join(", ")}.`);
  return withActor(actor, async (tx) => {
    const quote = await lockDraft(tx, id);
    const company = await loadCompany();
    const lines = await tx.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
    const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId!));
    const year = Number(quote.issueDate.slice(0, 4));
    const [counter] = await tx
      .insert(schema.quoteNumberCounters)
      .values({ year, last: 1 })
      .onConflictDoUpdate({ target: schema.quoteNumberCounters.year, set: { last: sql`${schema.quoteNumberCounters.last} + 1` } })
      .returning();
    const number = formatQuoteNumber(year, counter!.last);
    const seller = sellerFrom(company);
    const buyer = buyerFrom(contact!);
    const doc = documentFor(quote, lines, seller, buyer, number);
    const pdf = buildQuotePdf(doc);
    const now = new Date();
    const [finalized] = await tx
      .update(schema.quotes)
      .set({
        status: "final",
        number,
        numberYear: year,
        numberCounter: counter!.last,
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

async function lockFinal(tx: Tx, id: string): Promise<Quote> {
  const [quote] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, id)).for("update");
  if (!quote) throw new QuoteError("Angebot nicht gefunden.");
  if (quote.status !== "final") throw new QuoteError("Das Angebot ist noch ein Entwurf.");
  return quote;
}

/** Antwort des Kunden festhalten oder zurücknehmen; nicht mehr, sobald eine Rechnung daraus entstanden ist */
export async function setQuoteDecision(actor: string, id: string, decision: "angenommen" | "abgelehnt" | null): Promise<void> {
  await withActor(actor, async (tx) => {
    const quote = await lockFinal(tx, id);
    if (quote.invoiceId) throw new QuoteError("Aus dem Angebot ist bereits eine Rechnung entstanden.");
    await tx
      .update(schema.quotes)
      .set({ decision, decidedAt: decision ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.quotes.id, id));
  });
}

/**
 * Rechnungsentwurf aus dem Angebot: Kunde, Positionen, Leistungszeitraum und Umsatzsteuer übernommen,
 * Datum heute, Zahlungsziel und Format wie bei neuen Rechnungen. Das Angebot gilt damit als angenommen.
 */
export async function quoteToInvoice(actor: string, id: string, today: string): Promise<Invoice> {
  const data = await getQuote(id);
  if (!data) throw new QuoteError("Angebot nicht gefunden.");
  const { quote, lines, contact } = data;
  if (quote.status !== "final") throw new QuoteError("Nur festgeschriebene Angebote lassen sich abrechnen.");
  if (quote.invoiceId) throw new QuoteError("Aus dem Angebot ist bereits eine Rechnung entstanden.");
  if (quote.decision === "abgelehnt") throw new QuoteError("Das Angebot ist als abgelehnt markiert.");
  const company = await loadCompany();
  const invoice = await createDraft(actor, {
    contactId: quote.contactId,
    issueDate: today,
    serviceFrom: quote.serviceFrom,
    serviceTo: quote.serviceTo,
    paymentTermDays: company.paymentTermDays,
    format: contact?.defaultFormat ?? (contact?.leitwegId ? "xrechnung-cii" : company.defaultFormat),
    note: `Gemäß unserem Angebot ${quote.number} vom ${quote.issueDate.split("-").reverse().join(".")}.`,
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate as 1900 | 700 | 0,
    })),
  });
  try {
    await withActor(actor, async (tx) => {
      const locked = await lockFinal(tx, id);
      if (locked.invoiceId) throw new QuoteError("Aus dem Angebot ist bereits eine Rechnung entstanden.");
      await tx
        .update(schema.quotes)
        .set({ invoiceId: invoice.id, decision: "angenommen", decidedAt: locked.decidedAt ?? new Date(), updatedAt: new Date() })
        .where(eq(schema.quotes.id, id));
    });
  } catch (error) {
    await deleteDraft(actor, invoice.id);
    throw error;
  }
  return invoice;
}

/** Neuer Entwurf mit Kunde und Positionen eines vorhandenen Angebots, Datum und Gültigkeit neu */
export async function copyQuote(actor: string, id: string, today: string): Promise<Quote> {
  const data = await getQuote(id);
  if (!data) throw new QuoteError("Angebot nicht gefunden.");
  const { quote, lines } = data;
  const validDays = Math.max(0, Math.round((Date.parse(quote.validUntil) - Date.parse(quote.issueDate)) / 86_400_000));
  return createQuoteDraft(actor, {
    contactId: quote.contactId,
    issueDate: today,
    validUntil: addDays(today, validDays || QUOTE_VALID_DAYS),
    serviceFrom: null,
    serviceTo: null,
    note: quote.note,
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate as 1900 | 700 | 0,
    })),
  });
}

export async function loadQuotePdf(id: string) {
  const [row] = await db.select({ pdf: schema.quotes.pdf, number: schema.quotes.number }).from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!row?.pdf || !row.number) return null;
  return { pdf: row.pdf, filename: `Angebot-${row.number}.pdf` };
}
