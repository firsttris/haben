import { UserError } from "../../errors.ts";
import {
  computeInvoice,
  CURRENCY_CODE,
  describeExchangeRate,
  formatRateMonth,
  parseExchangeRate,
  rateMonth,
  totalsFromTaxes,
  formatInvoiceNumber,
  invoiceLineInputSchema,
  invoiceDueDate,
  invoicePosting,
  legacyCorrectionPosting,
  lineAmount,
  PRICE_MODES,
  TAX_TREATMENT_KEYS,
  type InvoiceCalculation,
  type InvoiceTotals,
  type PriceMode,
  type TaxTreatment,
  type UnitLabel,
  cancellationProblem,
  invoiceEditProblem,
  invoiceListStatus,
  invoiceOpen,
  type InvoiceListStatus,
} from "@haben/core";
import {
  buildEInvoice,
  texts,
  validateForFormat,
  type Buyer,
  type InvoiceDocument,
  type InvoiceFormat,
  type Seller,
} from "@haben/einvoice";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany, NO_RATE, resolveExchangeRate, sellerIssues, versteuerungForYear, type Company, type RateFields } from "../stammdaten/index.ts";
import type { Contact } from "../stammdaten/index.ts";
import { loadLogo } from "../stammdaten/index.ts";
import { invoiceLosses, invoicePayments, invoiceWrittenOff } from "../bank/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { euroTaxes, invoiceDocumentTotals, invoiceTotalsById, storeInvoiceTaxes } from "./invoice-taxes.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { today } from "../../today.ts";
import { lockNumbering, peekNumber, setNextNumber as setNextCounter, takeNumber } from "./number-counter.ts";

export type Invoice = typeof schema.invoices.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLines.$inferSelect;

export class InvoiceError extends UserError {}

const isoDate = z.iso.date();

export const draftSchema = z
  .object({
    contactId: z.uuid().nullable(),
    issueDate: isoDate,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    paymentTermDays: z.number().int().min(0).max(120),
    format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
    note: z.string().max(2000),
    taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
    exemptionReason: z.string().trim().max(300).default(""),
    /** Einzelpreise netto oder brutto inkl. USt; brutto nur bei regulärer Besteuerung */
    priceMode: z.enum(PRICE_MODES).default("netto"),
    /** Sprache des PDFs für den Kunden */
    language: z.enum(["de", "en"]).default("de"),
    /** Abschlags- oder Schlussrechnung; null = normale Rechnung */
    variant: z.enum(["abschlag", "schluss"]).nullable().default(null),
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
    lines: z.array(invoiceLineInputSchema).max(200),
  })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  });

export type DraftInput = z.input<typeof draftSchema>;
type LineInput = DraftInput["lines"][number] & { deductionOf?: string };

/** Ohne Steuerausweis gibt es keine Bruttopreise: dort sind netto und brutto gleich */
export function effectivePriceMode(input: { priceMode?: PriceMode | undefined; taxTreatment?: TaxTreatment | undefined }): PriceMode {
  return (input.taxTreatment ?? "regulaer") === "regulaer" ? (input.priceMode ?? "netto") : "netto";
}

function lineRows(invoiceId: string, lines: LineInput[], lineNets: number[]) {
  return lines.map((line, index) => ({
    invoiceId,
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNets[index]!,
    deductionOf: line.deductionOf ?? null,
  }));
}

/** Positionen und Steuerzeilen eines Entwurfs speichern, wie sie draftValues berechnet hat */
async function storeLines(tx: Tx, invoiceId: string, lines: LineInput[], { lineNets }: InvoiceCalculation, taxes: ReturnType<typeof euroTaxes>) {
  await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
  if (lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(invoiceId, lines, lineNets));
  await storeInvoiceTaxes(tx, invoiceId, taxes);
}

/** Höchstwert der int4-Spalten für Euro-Beträge: ein sehr kleiner Kurs darf sie nicht sprengen */
const MAX_EURO_CENTS = 2_147_483_647;

/** Monat der Leistung für den Umrechnungskurs: Ende des Leistungszeitraums, sonst das Rechnungsdatum */
const serviceDate = (input: { issueDate: string; serviceFrom?: string | null; serviceTo?: string | null }) => input.serviceTo ?? input.serviceFrom ?? input.issueDate;

/**
 * Kurs eines Entwurfs: Storno und Korrektur übernehmen Währung und Kurs der ursprünglichen Rechnung (dieselben Euro-Beträge
 * mit umgekehrtem Vorzeichen), sonst wie bei Belegen (resolveExchangeRate) für den Monat der Leistung.
 */
async function draftRate(tx: Tx, input: DraftInput, correctsId: string | null, previous: Invoice | null): Promise<{ currency: string } & RateFields> {
  if (correctsId) {
    const [original] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, correctsId));
    if (original) {
      return { currency: original.currency, exchangeRate: original.exchangeRate ? parseExchangeRate(original.exchangeRate) : null, exchangeRateSource: original.exchangeRateSource, exchangeRateDate: original.exchangeRateDate };
    }
  }
  // Die Server Functions prüfen das Eingabeschema schon; hier nur die Felder der Währung, in der Form des Schemas
  const currency = (input.currency ?? "EUR").trim().toUpperCase();
  if (currency === "EUR") return { currency, ...NO_RATE };
  if (!CURRENCY_CODE.test(currency)) throw new InvoiceError("Währung als dreistelliger Code, z. B. USD.");
  const exchangeRate = input.exchangeRate?.trim() ? parseExchangeRate(input.exchangeRate) : null;
  if (input.exchangeRate?.trim() && !exchangeRate) throw new InvoiceError("Umrechnungskurs ungültig, z. B. 1,0812.");
  const { tageskurs } = await loadCompany(tx);
  const rate = await resolveExchangeRate(
    tx,
    { currency, date: serviceDate(input), exchangeRate, exchangeRateDate: input.exchangeRateDate ?? null },
    previous && previous.currency === currency ? previous : null,
    tageskurs,
  );
  return { currency, ...rate };
}

/** Titel je Rechnung, auch für Buchungstext und E-Mail */
export function invoiceTitle(invoice: Pick<Invoice, "kind" | "variant">): string {
  if (invoice.kind === "rechnung" && invoice.variant) return { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" }[invoice.variant];
  return { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" }[invoice.kind];
}

/** Festgeschriebene Rechnungen, die eine Stornorechnung aufhebt */
const cancelledIds = sql`select corrects_id from invoices where kind = 'storno' and status = 'final' and corrects_id is not null`;

/**
 * Schlussrechnungen, die eine Abschlagsrechnung schon abziehen (festgeschrieben, nicht storniert),
 * je Abschlagsrechnung die Nummer der Schlussrechnung
 */
async function deductedElsewhere(abschlagIds: string[], exceptInvoiceId: string | null, q: Db | Tx = db): Promise<Map<string, string>> {
  if (abschlagIds.length === 0) return new Map();
  const rows = await q
    .select({ abschlag: schema.invoiceLines.deductionOf, number: schema.invoices.number })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(
      and(
        inArray(schema.invoiceLines.deductionOf, abschlagIds),
        eq(schema.invoices.status, "final"),
        sql`${schema.invoices.id} not in (${cancelledIds})`,
        exceptInvoiceId ? ne(schema.invoices.id, exceptInvoiceId) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.abschlag!, r.number ?? ""]));
}

/** Abschlagsrechnungen eines Kunden, die eine Schlussrechnung noch abziehen kann */
export async function openAbschlaege(exceptInvoiceId: string | null = null, q: Db | Tx = db) {
  const rows = await q
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.variant, "abschlag"),
        eq(schema.invoices.status, "final"),
        sql`${schema.invoices.id} not in (${cancelledIds})`,
      ),
    )
    .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.number));
  const taken = await deductedElsewhere(
    rows.map((r) => r.id),
    exceptInvoiceId,
    q,
  );
  const open = rows.filter((r) => !taken.has(r.id));
  const totals = await invoiceTotalsById(open.map((r) => r.id), q);
  return open.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    quoteId: r.quoteId,
    number: r.number!,
    issueDate: r.issueDate,
    taxTreatment: r.taxTreatment,
    priceMode: r.priceMode,
    net: r.net,
    tax: r.tax,
    gross: r.gross,
    /** Netto und Steuer je Steuersatz, wie sie abgezogen werden */
    rates: totals.get(r.id)!.taxes,
  }));
}

export type OpenAbschlag = Awaited<ReturnType<typeof openAbschlaege>>[number];

/**
 * Abzugspositionen der Schlussrechnung: je Abschlagsrechnung und Steuersatz eine negative Position,
 * bei Bruttopreisen über Netto und Umsatzsteuer der Abschlagsrechnung
 */
function deductionLinesFor(abschlaege: OpenAbschlag[], language: "de" | "en", taxTreatment: TaxTreatment, priceMode: PriceMode): LineInput[] {
  const t = texts(language);
  return abschlaege.flatMap((a) =>
    a.rates
      .filter((r) => r.base !== 0)
      .map((r) => ({
        description: t.deduction(a.number, t.date(a.issueDate), t.money(r.base), taxTreatment === "regulaer" ? t.money(r.tax) : null),
        quantity: 1000,
        unit: "Psch." as UnitLabel,
        unitPrice: -(priceMode === "brutto" ? r.base + r.tax : r.base),
        taxRate: r.rate as 1900 | 700 | 0,
        deductionOf: a.id,
      })),
  );
}

/** Für die Detailseite: welche Abschläge eine Schlussrechnung abzieht und wo eine Abschlagsrechnung abgezogen ist */
export async function abschlagLinks(invoiceId: string) {
  const deducts = await db
    .selectDistinct({ id: schema.invoices.id, number: schema.invoices.number })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(eq(schema.invoiceLines.invoiceId, invoiceId));
  const deductedIn = await db
    .selectDistinct({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(and(eq(schema.invoiceLines.deductionOf, invoiceId), sql`${schema.invoices.id} not in (${cancelledIds})`));
  return { deducts, deductedIn };
}

/** Prüft die gewählten Abschlagsrechnungen; leere Liste = in Ordnung */
async function deductionProblems(invoiceId: string | null, input: Pick<DraftInput, "contactId" | "deducts" | "taxTreatment">, q: Db | Tx = db) {
  const ids = [...new Set(input.deducts ?? [])];
  const open = await openAbschlaege(invoiceId, q);
  const problems: string[] = [];
  const chosen: OpenAbschlag[] = [];
  for (const id of ids) {
    const abschlag = open.find((a) => a.id === id);
    if (!abschlag) {
      const [row] = await q.select({ number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, id));
      const taken = (await deductedElsewhere([id], invoiceId, q)).get(id);
      problems.push(
        taken
          ? `Abschlagsrechnung ${row?.number ?? ""} ist schon in Schlussrechnung ${taken} abgezogen`
          : `Abschlagsrechnung ${row?.number ?? id} ist nicht festgeschrieben oder storniert`,
      );
    } else if (abschlag.contactId !== input.contactId) problems.push(`Abschlagsrechnung ${abschlag.number} gehört zu einem anderen Kunden`);
    else if (abschlag.taxTreatment !== (input.taxTreatment ?? "regulaer")) problems.push(`Abschlagsrechnung ${abschlag.number} hat eine andere Umsatzsteuer-Behandlung`);
    else chosen.push(abschlag);
  }
  return { problems, chosen };
}

/** Bezug nur zu einem festgeschriebenen Angebot; ein Entwurf ließe sich sonst nicht mehr löschen */
async function checkQuote(tx: Tx, quoteId: string | null | undefined) {
  if (!quoteId) return;
  const [quote] = await tx.select({ status: schema.quotes.status }).from(schema.quotes).where(eq(schema.quotes.id, quoteId));
  if (quote?.status !== "final") throw new InvoiceError("Das Angebot ist nicht festgeschrieben.");
}

/**
 * Angebote, deren Abrechnungsstand eine Rechnung berühren kann: ihr Bezug (quote_id) und Angebote, die über
 * quotes.invoice_id auf sie zeigen (auch ältere Rechnungen ohne quote_id), dazu `extra` (neuer Bezug beim Speichern)
 */
async function quotesTouching(tx: Tx, invoiceIds: (string | null | undefined)[], extra: (string | null | undefined)[] = []): Promise<string[]> {
  const ids = invoiceIds.filter((i): i is string => Boolean(i));
  const linked =
    ids.length === 0
      ? []
      : [
          ...(await tx.select({ id: schema.invoices.quoteId }).from(schema.invoices).where(inArray(schema.invoices.id, ids))).map((r) => r.id),
          ...(await tx.select({ id: schema.quotes.id }).from(schema.quotes).where(inArray(schema.quotes.invoiceId, ids))).map((r) => r.id),
        ];
  return [...new Set([...linked, ...extra].filter((q): q is string => Boolean(q)))].sort();
}

/**
 * Sperrt die Angebote nach id. Feste Reihenfolge überall, wo sich der Abrechnungsstand eines Angebots ändern kann:
 * Angebot, dann Rechnung, dann Nummernkreis, dann (mit dem ersten Audit-Eintrag) die Hash-Kette. quoteToInvoice sperrt das
 * Angebot ebenfalls zuerst. Zwei gleichzeitige Rechnungen zu einem Angebot warten so aufeinander, und die Prüfungen beim
 * Festschreiben sehen die jeweils andere.
 */
async function lockQuotes(tx: Tx, quoteIds: string[]): Promise<string[]> {
  if (quoteIds.length > 0) {
    await tx.select({ id: schema.quotes.id }).from(schema.quotes).where(inArray(schema.quotes.id, quoteIds)).orderBy(asc(schema.quotes.id)).for("update");
  }
  return quoteIds;
}

/** Nach dem Sperren der Rechnung: Hat sich ihr Bezug seit dem Lesen geändert, wären die falschen Angebote gesperrt */
async function assertQuotesLocked(tx: Tx, locked: string[], invoiceIds: (string | null | undefined)[], extra: (string | null | undefined)[] = []) {
  if ((await quotesTouching(tx, invoiceIds, extra)).some((q) => !locked.includes(q))) {
    throw new InvoiceError("Die Rechnung wurde gerade an anderer Stelle geändert. Bitte die Seite neu laden.");
  }
}

/** Rechnung über das ganze Angebot: normale Rechnung oder Schlussrechnung, nicht der Abschlag */
const billsWholeQuote = or(isNull(schema.invoices.variant), eq(schema.invoices.variant, "schluss"));

/**
 * quotes.invoice_id (Angebot abgerechnet) aus den Rechnungen mit Bezug zum Angebot: die nicht stornierte Rechnung über das
 * ganze Angebot, festgeschriebene vor Entwürfen; nach einem Storno ist das Angebot wieder offen. Aufgerufen, wann immer sich Bezug, Rechnungsart oder
 * Status einer solchen Rechnung ändern kann. Ältere festgeschriebene Rechnungen ohne quote_id, die nur über
 * quotes.invoice_id verknüpft sind, bleiben stehen.
 */
async function syncQuoteBilling(tx: Tx, quoteIds: (string | null | undefined)[]) {
  for (const quoteId of new Set(quoteIds.filter((q): q is string => Boolean(q)))) {
    // Gesperrt ist das Angebot schon (lockQuotes bzw. lockQuote am Anfang der Transaktion)
    const [quote] = await tx.select({ invoiceId: schema.quotes.invoiceId }).from(schema.quotes).where(eq(schema.quotes.id, quoteId));
    if (!quote) continue;
    if (quote.invoiceId) {
      const [current] = await tx
        .select({
          quoteId: schema.invoices.quoteId,
          lockedAt: schema.invoices.lockedAt,
          cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIds})`,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, quote.invoiceId));
      // Ältere Rechnung ohne quote_id rechnet das Angebot ab, solange sie nicht storniert ist
      if (current && current.quoteId === null && current.lockedAt && !current.cancelled) continue;
    }
    const [billing] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(
        and(eq(schema.invoices.quoteId, quoteId), eq(schema.invoices.kind, "rechnung"), billsWholeQuote, sql`${schema.invoices.id} not in (${cancelledIds})`),
      )
      .orderBy(sql`${schema.invoices.status} <> 'final'`, desc(schema.invoices.createdAt))
      .limit(1);
    const invoiceId = billing?.id ?? null;
    if (invoiceId !== quote.invoiceId) {
      await tx.update(schema.quotes).set({ invoiceId, updatedAt: new Date() }).where(eq(schema.quotes.id, quoteId));
    }
  }
}

/** Positionen einer Rechnung samt Abzügen bei der Schlussrechnung; die Abschläge geprüft in der Transaktion, die speichert */
async function allLines(tx: Tx, invoiceId: string | null, input: DraftInput): Promise<LineInput[]> {
  if (input.variant !== "schluss") return input.lines;
  const { problems, chosen } = await deductionProblems(invoiceId, input, tx);
  if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
  return [...input.lines, ...deductionLinesFor(chosen, input.language ?? "de", input.taxTreatment ?? "regulaer", effectivePriceMode(input))];
}

/**
 * Entwurf in Fremdwährung ohne Kurs, dessen USt-Umrechnungskurs inzwischen veröffentlicht ist: Kurs übernehmen und die
 * gespeicherten Originalbeträge in Euro umrechnen. true, wenn sich etwas geändert hat.
 */
async function applyRateToDraft(tx: Tx, invoice: Invoice): Promise<boolean> {
  // Ohne Kurs oder mit übernommenem USt-Kurs: Ein eigener Kurs bleibt, ein geänderter Tabellenkurs (etwa der amtliche statt
  // eines vorab von Hand eingetragenen) gilt auch für den Entwurf
  if (invoice.status !== "draft" || invoice.currency === "EUR" || invoice.correctsId) return false;
  if (invoice.exchangeRate && invoice.exchangeRateSource !== "ust") return false;
  const rate = await resolveExchangeRate(tx, { currency: invoice.currency, date: serviceDate(invoice), exchangeRate: null, exchangeRateDate: null }, null, false);
  if (!rate.exchangeRate || (invoice.exchangeRate && parseExchangeRate(invoice.exchangeRate) === rate.exchangeRate)) return false;
  const rows = await tx.select().from(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.invoiceId, invoice.id));
  const taxes = euroTaxes(
    rows.map((r) => ({ rate: r.rate, base: r.originalBase ?? 0, tax: r.originalTax ?? 0 })),
    invoice.currency,
    rate.exchangeRate,
  );
  if (taxes.some((t) => Math.abs(t.base) > MAX_EURO_CENTS || Math.abs(t.tax) > MAX_EURO_CENTS)) return false;
  await storeInvoiceTaxes(tx, invoice.id, taxes);
  const totals = totalsFromTaxes(taxes);
  await tx
    .update(schema.invoices)
    .set({ ...rate, net: totals.net, tax: totals.tax, gross: totals.gross, updatedAt: new Date() })
    .where(eq(schema.invoices.id, invoice.id));
  return true;
}

/** Entwürfe in Fremdwährung ohne Kurs oder mit geändertem USt-Kurs umrechnen (nach dem Abruf der Kurse); Zahl der Entwürfe */
export async function applyPublishedRatesToDrafts(actor: string): Promise<number> {
  const drafts = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "draft"),
        ne(schema.invoices.currency, "EUR"),
        sql`(${schema.invoices.exchangeRate} is null or ${schema.invoices.exchangeRateSource} = 'ust')`,
      ),
    );
  let count = 0;
  for (const { id } of drafts) {
    const changed = await withActor(actor, async (tx) => {
      const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id)).for("update");
      return invoice ? applyRateToDraft(tx, invoice) : false;
    });
    if (changed) count++;
  }
  return count;
}

/**
 * Felder eines Entwurfs samt Summen. Netto und Umsatzsteuer je Satz werden nur hier berechnet; danach
 * lesen alle anderen Stellen die gespeicherten Werte (invoice_taxes).
 */
function draftValues(input: DraftInput, bundesland: Company["bundesland"], lines: LineInput[], rate: { currency: string } & RateFields) {
  const priceMode = effectivePriceMode(input);
  const calculation = computeInvoice(lines, priceMode);
  // Gebucht wird in Euro: bei Fremdwährung je Satz mit dem Kurs umgerechnet
  const taxes = euroTaxes(calculation.totals.taxes, rate.currency, rate.exchangeRate);
  if (rate.currency !== "EUR" && taxes.some((t) => Math.abs(t.base) > MAX_EURO_CENTS || Math.abs(t.tax) > MAX_EURO_CENTS)) {
    throw new InvoiceError("Der umgerechnete Betrag ist zu groß. Stimmt der Kurs (1 EUR = … Fremdwährung)?");
  }
  const totals = totalsFromTaxes(taxes);
  const values = {
    contactId: input.contactId,
    issueDate: input.issueDate,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    paymentTermDays: input.paymentTermDays,
    dueDate: invoiceDueDate(input.issueDate, input.paymentTermDays, bundesland),
    format: input.format,
    note: input.note,
    taxTreatment: input.taxTreatment ?? "regulaer",
    exemptionReason: input.taxTreatment && input.taxTreatment !== "regulaer" ? (input.exemptionReason ?? "").trim() : "",
    priceMode,
    language: input.language ?? "de",
    variant: input.variant ?? null,
    quoteId: input.quoteId ?? null,
    ...rate,
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
  return { values, calculation, taxes };
}

type DraftExtra = Partial<Pick<Invoice, "kind" | "correctsId" | "recurringId" | "recurringDate">>;

export async function createDraft(actor: string, input: DraftInput, extra: DraftExtra = {}) {
  return withActor(actor, (tx) => insertDraft(tx, input, extra));
}

/** Legt einen Entwurf in einer laufenden Transaktion an, z. B. zusammen mit dem Festschreiben (Storno) */
export async function insertDraft(tx: Tx, input: DraftInput, extra: DraftExtra = {}): Promise<Invoice> {
  await lockQuotes(tx, input.quoteId ? [input.quoteId] : []);
  const { bundesland } = await loadCompany(tx);
  await checkQuote(tx, input.quoteId);
  const lines = await allLines(tx, null, input);
  const { values, calculation, taxes } = draftValues(input, bundesland, lines, await draftRate(tx, input, extra.correctsId ?? null, null));
  const [invoice] = await tx
    .insert(schema.invoices)
    .values({ ...values, ...extra })
    .returning();
  await storeLines(tx, invoice!.id, lines, calculation, taxes);
  await syncQuoteBilling(tx, [invoice!.quoteId]);
  return invoice!;
}

async function lockDraft(tx: Tx, id: string): Promise<Invoice> {
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id)).for("update");
  if (!invoice) throw new InvoiceError("Rechnung nicht gefunden.");
  const problem = invoiceEditProblem(invoice);
  if (problem) throw new InvoiceError(problem);
  return invoice;
}

export async function updateDraft(actor: string, id: string, input: DraftInput) {
  return withActor(actor, async (tx) => {
    const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id], [input.quoteId]));
    const draft = await lockDraft(tx, id);
    await assertQuotesLocked(tx, quoteIds, [id], [input.quoteId]);
    const { bundesland } = await loadCompany(tx);
    if (draft.kind === "rechnung") await checkQuote(tx, input.quoteId);
    const lines = await allLines(tx, id, input);
    if (input.variant && draft.kind !== "rechnung") throw new InvoiceError("Storno und Korrektur sind keine Abschlags- oder Schlussrechnung.");
    // Eine Korrektur rechnet wie die ursprüngliche Rechnung, netto oder brutto
    const rate = await draftRate(tx, input, draft.correctsId, draft);
    const { values, calculation, taxes } = draftValues(
      draft.kind === "rechnung" ? input : { ...input, priceMode: draft.priceMode, quoteId: null },
      bundesland,
      lines,
      rate,
    );
    const [updated] = await tx.update(schema.invoices).set(values).where(eq(schema.invoices.id, id)).returning();
    await storeLines(tx, id, lines, calculation, taxes);
    // Bezug oder Rechnungsart geändert: das bisherige und das neue Angebot neu bewerten
    await syncQuoteBilling(tx, quoteIds);
    return updated!;
  });
}

export async function deleteDraft(actor: string, id: string) {
  await withActor(actor, async (tx) => {
    const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id]));
    await lockDraft(tx, id);
    await assertQuotesLocked(tx, quoteIds, [id]);
    // Aus einem Angebot entstanden: das Angebot lässt sich danach wieder abrechnen
    await tx.update(schema.quotes).set({ invoiceId: null, updatedAt: new Date() }).where(eq(schema.quotes.invoiceId, id));
    await tx.delete(schema.invoices).where(eq(schema.invoices.id, id));
    await syncQuoteBilling(tx, quoteIds);
  });
}

/** Neue Rechnung mit den Vorgaben aus den Firmendaten */
export async function newDraftDefaults(today: string) {
  const company = await loadCompany();
  return {
    contactId: null,
    issueDate: today,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: company.paymentTermDays,
    format: company.defaultFormat,
    note: "",
    taxTreatment: (company.kleinunternehmer ? "kleinunternehmer" : "regulaer") as TaxTreatment,
    exemptionReason: "",
    priceMode: "netto" as PriceMode,
    language: "de" as const,
    variant: null,
    deducts: [] as string[],
    lines: [
      { description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: (company.kleinunternehmer ? 0 : 1900) as 1900 | 0 },
    ],
  } satisfies DraftInput;
}

export async function getInvoice(id: string, q: Db | Tx = db) {
  const [invoice] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice) return null;
  const lines = await q
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, id))
    .orderBy(asc(schema.invoiceLines.position));
  const [contact] = invoice.contactId
    ? await q.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId))
    : [];
  const [corrects] = invoice.correctsId
    ? await q
        .select({ id: schema.invoices.id, number: schema.invoices.number, issueDate: schema.invoices.issueDate })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoice.correctsId))
    : [];
  const correctedBy = await q
    .select({ id: schema.invoices.id, number: schema.invoices.number, kind: schema.invoices.kind, status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.correctsId, id))
    .orderBy(asc(schema.invoices.createdAt));
  return { invoice, lines, contact: contact ?? null, corrects: corrects ?? null, correctedBy };
}

export type { InvoiceListStatus };

/**
 * Rechnungsliste mit offenem Betrag und Status (Regeln in @haben/core, lebenszyklus.ts); bezahlt über die Zuordnungen
 * im Bankabgleich. Mit `id` nur diese Rechnung. Rechnungsliste, offene Posten, Mahnwesen und die Sperre der
 * Firmendaten zählen über diese Funktion, damit „offen“ überall dasselbe heißt.
 */
export async function listInvoices(today: string, id?: string, q: Db | Tx = db) {
  const rows = await q
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      variant: schema.invoices.variant,
      status: schema.invoices.status,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      net: schema.invoices.net,
      correctsId: schema.invoices.correctsId,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
      cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIds})`,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(id ? eq(schema.invoices.id, id) : undefined)
    .orderBy(sql`${schema.invoices.number} desc nulls first`, desc(schema.invoices.createdAt));

  const paid = await invoicePayments(
    [...rows.filter((r) => r.status === "final").map((r) => r.id), ...rows.filter((r) => r.kind === "storno" && r.correctsId).map((r) => r.correctsId!)],
    q,
  );
  const losses = await invoiceLosses(rows.filter((r) => r.status === "final").map((r) => r.id), q);
  return rows.map(({ cancelled, ...row }) => {
    const facts = {
      ...row,
      paid: paid.get(row.id) ?? 0,
      writtenOffLoss: losses.get(row.id) ?? 0,
      cancelled,
      // Bei einem Storno bleibt offen, was auf die Rechnung gezahlt und noch nicht erstattet wurde
      paidOnOriginal: row.correctsId ? (paid.get(row.correctsId) ?? 0) : 0,
    };
    return {
      ...row,
      customer: row.buyerName ?? row.contactName ?? "–",
      listStatus: invoiceListStatus(facts, today),
      paid: facts.paid,
      open: invoiceOpen(facts),
    };
  });
}

export function sellerFrom(company: Company): Seller {
  return {
    name: company.name,
    strasse: company.strasse,
    plz: company.plz,
    ort: company.ort,
    land: "DE",
    email: company.email,
    ...(company.telefon ? { telefon: company.telefon } : {}),
    ...(company.steuernummer ? { steuernummer: company.steuernummer } : {}),
    ...(company.ustId ? { ustId: company.ustId } : {}),
    ...(company.iban ? { iban: company.iban } : {}),
    ...(company.bic ? { bic: company.bic } : {}),
    ...(company.bank ? { bank: company.bank } : {}),
  };
}

export function buyerFrom(contact: Contact): Buyer {
  return {
    name: contact.name,
    strasse: contact.strasse,
    plz: contact.plz,
    ort: contact.ort,
    land: contact.land,
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.ustId ? { ustId: contact.ustId } : {}),
    ...(contact.leitwegId ? { leitwegId: contact.leitwegId } : {}),
    ...(contact.kundennummer ? { kundennummer: contact.kundennummer } : {}),
  };
}

function documentFor(
  invoice: Invoice,
  lines: InvoiceLine[],
  totals: InvoiceTotals,
  euroTotals: InvoiceTotals,
  seller: Seller,
  buyer: Buyer,
  number: string,
  corrects: { number: string; issueDate: string } | null,
  deducted: { number: string; issueDate: string }[] = [],
): InvoiceDocument {
  return {
    kind: invoice.kind,
    format: invoice.format as InvoiceFormat,
    number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermDays: invoice.paymentTermDays,
    ...(invoice.serviceFrom ? { serviceFrom: invoice.serviceFrom } : {}),
    ...(invoice.serviceTo ? { serviceTo: invoice.serviceTo } : {}),
    currency: invoice.currency,
    // Fremdwährung: die Umsatzsteuer zusätzlich in Euro (§ 14 Abs. 4 Nr. 8 UStG), mit Kurs und Herkunft
    ...(invoice.currency !== "EUR" && invoice.exchangeRate
      ? {
          euroTax: {
            tax: euroTotals.tax,
            taxes: euroTotals.taxes.map((t) => ({ rate: t.rate, tax: t.tax })),
            rate: describeExchangeRate(invoice.currency, invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateDate),
          },
        }
      : {}),
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
    totals,
    ...(corrects ? { corrects } : {}),
    ...(invoice.note ? { note: invoice.note } : {}),
    ...(invoice.taxTreatment !== "regulaer" ? { taxTreatment: invoice.taxTreatment } : {}),
    ...(invoice.exemptionReason ? { exemptionReason: invoice.exemptionReason } : {}),
    ...(invoice.priceMode === "brutto" ? { priceMode: invoice.priceMode } : {}),
    language: invoice.language,
    ...(invoice.kind === "rechnung" && invoice.variant ? { variant: invoice.variant } : {}),
    ...(deducted.length > 0 ? { deducted } : {}),
  };
}

/** Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
const deductionIds = (lines: InvoiceLine[]) => [...new Set(lines.map((l) => l.deductionOf).filter((id): id is string => Boolean(id)))];

/** Nummer und Datum der Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
async function deductedRefs(lines: InvoiceLine[], q: Db | Tx = db) {
  const ids = deductionIds(lines);
  if (ids.length === 0) return [];
  const rows = await q
    .select({ id: schema.invoices.id, number: schema.invoices.number, issueDate: schema.invoices.issueDate })
    .from(schema.invoices)
    .where(inArray(schema.invoices.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)!).map((r) => ({ number: r.number ?? "", issueDate: r.issueDate }));
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Prüft, ob ein Entwurf festgeschrieben werden kann; leere Liste = bereit. */
const VERSTEUERUNG = { soll: "Soll-Versteuerung", ist: "Ist-Versteuerung" } as const;

export async function finalizeIssues(id: string, q: Db | Tx = db): Promise<string[]> {
  const data = await getInvoice(id, q);
  if (!data) return ["Rechnung nicht gefunden"];
  const { invoice, lines, contact } = data;
  const company = await loadCompany(q);
  const issues = sellerIssues(company).map((issue) => `Firmendaten: ${issue}`);
  // Storno und Korrektur übernehmen die Behandlung des Originals, auch nach einem Wechsel der Einstellung
  if (invoice.kind === "rechnung" && company.kleinunternehmer && invoice.taxTreatment !== "kleinunternehmer") {
    issues.push("Als Kleinunternehmer stellst du Rechnungen ohne Umsatzsteuer (§ 19 UStG)");
  }
  if (invoice.kind === "rechnung" && !company.kleinunternehmer && invoice.taxTreatment === "kleinunternehmer") {
    issues.push("Kleinunternehmer ist in den Einstellungen nicht eingeschaltet");
  }
  // Gebucht wird nach der aktuellen Versteuerung, die Voranmeldung rechnet das Jahr aber nach der, die dort galt
  // (versteuerungForYear). Nach einem Wechsel zum Jahreswechsel stünde die Steuer einer Rechnung im Vorjahr sonst
  // zweimal in der Anmeldung (Soll → Ist) oder gar nicht (Ist → Soll).
  if (!company.kleinunternehmer) {
    const year = Number(invoice.issueDate.slice(0, 4));
    const versteuerung = await versteuerungForYear(year, q);
    if (versteuerung !== company.versteuerung) {
      issues.push(
        `Das Jahr ${year} ist nach ${VERSTEUERUNG[versteuerung]} gebucht, eingestellt ist jetzt ${VERSTEUERUNG[company.versteuerung]}; bitte ein Rechnungsdatum im laufenden Jahr wählen`,
      );
    }
  }
  if (!contact) issues.push("Kunde fehlt");
  if (lines.length === 0) issues.push("Keine Positionen");
  if (lines.some((line) => lineAmount(line.quantity, line.unitPrice) === 0)) issues.push("Position ohne Betrag");
  if (invoice.correctsId) {
    const [original] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
    const problem = original ? ((await originalProblem(original, q)) ?? (await reductionProblem(invoice, original, q))) : "Die korrigierte Rechnung fehlt";
    if (problem) issues.push(problem);
  }
  if (invoice.variant === "schluss") {
    const deducts = deductionIds(lines);
    if (deducts.length === 0) issues.push("Keine Abschlagsrechnung abgezogen");
    issues.push(...(await deductionProblems(id, { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment }, q)).problems);
    if (invoice.gross < 0) issues.push("Die Abschläge übersteigen die Gesamtleistung");
  } else if (invoice.kind === "rechnung" && invoice.gross <= 0) issues.push("Gesamtbetrag muss positiv sein");
  if (invoice.kind === "korrektur" && invoice.gross >= 0) issues.push("Eine Rechnungskorrektur muss den Betrag mindern");
  if (invoice.quoteId) {
    const [quote] = await q
      .select({ number: schema.quotes.number, status: schema.quotes.status, contactId: schema.quotes.contactId, decision: schema.quotes.decision })
      .from(schema.quotes)
      .where(eq(schema.quotes.id, invoice.quoteId));
    if (!quote || quote.status !== "final") issues.push("Das gewählte Angebot ist nicht festgeschrieben");
    else if (quote.contactId !== invoice.contactId) issues.push(`Angebot ${quote.number} gehört zu einem anderen Kunden`);
    else if (quote.decision === "abgelehnt") issues.push(`Angebot ${quote.number} ist als abgelehnt markiert`);
    else {
      // Schon über das Ganze abgerechnet (auch ältere Rechnungen, die nur über quotes.invoice_id verknüpft sind):
      // keine zweite Rechnung, keine weiteren Abschläge
      const [billed] = await q
        .select({ number: schema.invoices.number })
        .from(schema.invoices)
        .where(
          and(
            ne(schema.invoices.id, invoice.id),
            eq(schema.invoices.kind, "rechnung"),
            eq(schema.invoices.status, "final"),
            billsWholeQuote,
            sql`${schema.invoices.id} not in (${cancelledIds})`,
            or(eq(schema.invoices.quoteId, invoice.quoteId), sql`${schema.invoices.id} = (select invoice_id from quotes where id = ${invoice.quoteId})`),
          ),
        )
        .limit(1);
      if (billed) issues.push(`Angebot ${quote.number} ist schon mit Rechnung ${billed.number} abgerechnet`);
      if (invoice.variant === "schluss") {
        // Festgeschriebene Abschläge dieses Angebots, die keine Schlussrechnung abzieht, müssen hier abgezogen werden;
        // sonst wäre der Auftrag doppelt abgerechnet
        const deducted = new Set(deductionIds(lines));
        for (const a of (await openAbschlaege(id, q)).filter((a) => a.quoteId === invoice.quoteId && !deducted.has(a.id))) {
          issues.push(`Abschlagsrechnung ${a.number} zum Angebot ist noch nicht abgezogen`);
        }
      }
    }
  }
  if (invoice.currency !== "EUR") {
    if (invoice.variant) issues.push("Abschlags- und Schlussrechnungen gibt es nur in Euro");
    // Bei Ist-Versteuerung ist das Entgelt mit dem Kurs des Monats umzurechnen, in dem es vereinnahmt wird (Abschn. 16.4
    // UStAE); Haben rechnet mit dem Kurs der Rechnung. Ohne deutsche Umsatzsteuer (Leistung an ein Unternehmen im Ausland,
    // § 13b, steuerfrei) spielt das keine Rolle, mit deutscher Steuer wäre die Voranmeldung um die Kursänderung falsch.
    if (
      invoice.kind === "rechnung" &&
      !company.kleinunternehmer &&
      company.versteuerung === "ist" &&
      invoice.taxTreatment === "regulaer" &&
      lines.some((line) => line.taxRate > 0)
    ) {
      issues.push("Rechnungen in Fremdwährung mit deutscher Umsatzsteuer gehen nur bei Soll-Versteuerung; bei Ist-Versteuerung in Euro abrechnen");
    }
    if (!invoice.exchangeRate) {
      const month = rateMonth(serviceDate(invoice));
      issues.push(
        month >= rateMonth(today())
          ? `Umrechnungskurs für ${formatRateMonth(month)} noch nicht veröffentlicht; trag einen Kurs von Hand ein oder warte bis nach Monatsende`
          : `Umrechnungskurs für ${invoice.currency} ${formatRateMonth(month)} fehlt`,
      );
    }
  }
  if (contact && issues.length === 0) {
    const preview = documentFor(
      invoice,
      lines,
      await invoiceDocumentTotals(id, q),
      (await invoiceTotalsById([id], q)).get(id)!,
      sellerFrom(company),
      buyerFrom(contact),
      "VORSCHAU",
      data.corrects?.number ? { number: data.corrects.number, issueDate: data.corrects.issueDate } : null,
      await deductedRefs(lines, q),
    );
    issues.push(...validateForFormat(preview));
  }
  return issues;
}

/**
 * Festschreiben: Nummer ziehen, PDF und XML erzeugen, sperren und buchen – alles in einer
 * Transaktion. Schlägt etwas fehl, bleibt der Entwurf ohne Nummer und es entsteht keine Lücke.
 */
export async function finalizeInvoice(actor: string, id: string): Promise<Invoice> {
  return withActor(actor, (tx) => finalizeDraft(tx, id));
}

/** Festschreiben in einer laufenden Transaktion; prüft dort, was finalizeIssues meldet */
async function finalizeDraft(tx: Tx, id: string): Promise<Invoice> {
  // Angebote zuerst (lockQuotes): Die Prüfungen gegen andere Rechnungen desselben Angebots laufen erst unter der Sperre
  const [peek] = await tx.select({ correctsId: schema.invoices.correctsId }).from(schema.invoices).where(eq(schema.invoices.id, id));
  const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id, peek?.correctsId]));
  let invoice = await lockDraft(tx, id);
  await assertQuotesLocked(tx, quoteIds, [id, invoice.correctsId]);
  // Inzwischen veröffentlichten Kurs übernehmen, bevor geprüft wird
  if (await applyRateToDraft(tx, invoice)) invoice = await lockDraft(tx, id);
  const issues = await finalizeIssues(id, tx);
  if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);
  const company = await openBooks(tx);
  const lines = await tx
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, id))
    .orderBy(asc(schema.invoiceLines.position));
  const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId!));

  // Original und abgezogene Abschläge sperren und erneut prüfen: Ein paralleles Storno, eine Korrektur
  // oder eine andere Schlussrechnung kann seit finalizeIssues festgeschrieben worden sein.
  const deducts = deductionIds(lines);
  const referenced = [...(invoice.correctsId ? [invoice.correctsId] : []), ...deducts];
  if (referenced.length > 0) {
    await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(inArray(schema.invoices.id, referenced)).orderBy(asc(schema.invoices.id)).for("update");
  }
  let corrects: Invoice | undefined;
  if (invoice.correctsId) {
    [corrects] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
    const problem = corrects ? ((await originalProblem(corrects, tx)) ?? (await reductionProblem(invoice, corrects, tx))) : "Die korrigierte Rechnung fehlt";
    if (problem) throw new InvoiceError(`${problem}.`);
  }
  if (deducts.length > 0) {
    const { problems } = await deductionProblems(id, { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment }, tx);
    if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
  }

  // Nummer nur lesen (Sperre des Nummernkreises), PDF und XML erzeugen, erst dann schreiben: Bis zum ersten Schreiben
  // mit Audit-Eintrag ist die Hash-Kette frei, andere Schreibvorgänge warten nicht auf das Rendern (number-counter.ts)
  const year = Number(invoice.issueDate.slice(0, 4));
  const counter = await peekNumber(tx, "rechnung", year);
  const number = formatInvoiceNumber(year, counter);

  // Storno und Korrektur gehen an die Anschrift der ursprünglichen Rechnung.
  const seller = sellerFrom(company);
  const buyer = corrects?.buyer ?? buyerFrom(contact!);
  const totals = (await invoiceTotalsById([id], tx)).get(id)!;
  const doc = documentFor(invoice, lines, await invoiceDocumentTotals(id, tx), totals, seller, buyer, number, corrects ? { number: corrects.number!, issueDate: corrects.issueDate } : null, await deductedRefs(lines, tx));
  const logo = await loadLogo();
  const rendered = await buildEInvoice(logo ? { ...doc, logo } : doc);
  const now = new Date();

  await takeNumber(tx, "rechnung", year, counter);
  const [finalized] = await tx
    .update(schema.invoices)
    .set({
      status: "final",
      number,
      numberYear: year,
      numberCounter: counter,
      contactVersion: contact!.version,
      seller,
      buyer,
      net: totals.net,
      tax: totals.tax,
      gross: totals.gross,
      pdf: Buffer.from(rendered.pdf),
      pdfSha256: sha256(rendered.pdf),
      xml: rendered.xml,
      xmlSha256: sha256(rendered.xml),
      lockedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.invoices.id, id))
    .returning();

  await post(tx, company, {
    date: invoice.issueDate,
    description: `${invoiceTitle(invoice)} ${number} · ${buyer.name}`,
    sourceType: "invoice",
    sourceId: id,
    // Korrektur einer aus Lexoffice übernommenen Rechnung: deren Erlöse stehen in den alten Büchern
    lines: corrects?.lexofficeVoucherId
      ? legacyCorrectionPosting(totals, company.kontenrahmen, company.versteuerung)
      : invoicePosting(totals, company.kontenrahmen, company.versteuerung, invoice.taxTreatment),
  });
  // Festgeschrieben bzw. storniert: welche Rechnung das Angebot abrechnet, kann sich damit ändern
  await syncQuoteBilling(tx, quoteIds);

  return finalized!;
}

/** Was gegen Storno oder Korrektur einer Rechnung spricht; null = in Ordnung */
async function originalProblem(original: Invoice, q: Db | Tx = db): Promise<string | null> {
  const [storno] = await q
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, original.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")))
    .limit(1);
  const deductedIn = (await deductedElsewhere([original.id], null, q)).get(original.id) ?? null;
  return cancellationProblem(original, { cancelled: Boolean(storno), deductedIn });
}

/** Mehrere Korrekturen zusammen mindern eine Rechnung höchstens bis auf 0 */
async function reductionProblem(invoice: Invoice, original: Invoice, q: Db | Tx = db): Promise<string | null> {
  if (invoice.kind !== "korrektur") return null;
  const [corrections] = await q
    .select({ gross: sql<number>`coalesce(sum(${schema.invoices.gross}), 0)::int` })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.correctsId, original.id),
        eq(schema.invoices.kind, "korrektur"),
        eq(schema.invoices.status, "final"),
        ne(schema.invoices.id, invoice.id),
      ),
    );
  return original.gross + corrections!.gross + invoice.gross < 0 ? "Die Korrekturen mindern die Rechnung unter 0" : null;
}

async function finalOriginal(id: string, q: Db | Tx = db) {
  const data = await getInvoice(id, q);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  const problem = await originalProblem(data.invoice, q);
  if (problem) throw new InvoiceError(`${problem}.`);
  return data;
}

function negatedLines(lines: InvoiceLine[]): DraftInput["lines"] {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit as UnitLabel,
    unitPrice: -line.unitPrice,
    taxRate: line.taxRate as 1900 | 700 | 0,
  }));
}

/**
 * Stornorechnung mit allen Positionen negativ, sofort festgeschrieben. Entwurf und Festschreiben in einer Transaktion:
 * Schlägt das Festschreiben fehl oder bricht der Server ab, bleibt kein Storno-Entwurf zurück.
 */
export async function cancelInvoice(actor: string, id: string, today: string): Promise<Invoice> {
  return withActor(actor, async (tx) => {
    // Sperren in derselben Reihenfolge wie beim Festschreiben: Angebote der Rechnung (lockQuotes), Rechnungszeilen, dann
    // Nummernkreis, dann (mit dem ersten Audit-Eintrag) die Hash-Kette. Sonst verklemmen sich ein Storno und eine
    // gleichzeitig festgeschriebene Korrektur derselben Rechnung (die erst das Original, dann den Kreis sperrt).
    await lockQuotes(tx, await quotesTouching(tx, [id]));
    // Original zuerst: Ein zweites Storno wartet hier und sieht danach das erste. Erst mit dem Entwurf (Fremdschlüssel
    // auf das Original) und dann sperren hieße, dass sich zwei gleichzeitige Stornos verklemmen.
    await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.id, id)).for("update");
    // Kreis vor dem Entwurf, der schon einen Audit-Eintrag schreibt (number-counter.ts). Das PDF entsteht hier nach dem
    // Entwurf, also mit gesperrter Kette; ein Storno ist selten, der eine Entwurf in derselben Transaktion ist wichtiger.
    await lockNumbering(tx, "rechnung", Number(today.slice(0, 4)));
    const { invoice, lines } = await finalOriginal(id, tx);
    // Ein Storno nimmt die ganze Rechnung samt Umsatzsteuer zurück; eine Ausbuchung hat einen Teil davon schon gemindert
    // (doppelt bei Soll) und wäre im Storno als Erstattung offen, obwohl kein Geld geflossen ist
    if ((await invoiceWrittenOff([id], tx)).has(id)) {
      throw new InvoiceError("Die Rechnung ist teilweise ausgebucht (Skonto oder Forderungsausfall). Hebe die Ausbuchung zuerst auf, dann lässt sie sich stornieren.");
    }
    const draft = await insertDraft(
      tx,
      {
        contactId: invoice.contactId,
        issueDate: today,
        serviceFrom: invoice.serviceFrom,
        serviceTo: invoice.serviceTo,
        paymentTermDays: 0,
        format: invoice.format,
        note: "",
        taxTreatment: invoice.taxTreatment,
        exemptionReason: invoice.exemptionReason,
        priceMode: invoice.priceMode,
        language: invoice.language,
        lines: negatedLines(lines),
      },
      { kind: "storno", correctsId: invoice.id },
    );
    return finalizeDraft(tx, draft.id);
  });
}

/** Rechnungskorrektur als Entwurf: Positionen negativ übernommen, zum Anpassen. */
export async function createCorrection(actor: string, id: string, today: string): Promise<Invoice> {
  const { invoice, lines } = await finalOriginal(id);
  return createDraft(
    actor,
    {
      contactId: invoice.contactId,
      issueDate: today,
      serviceFrom: invoice.serviceFrom,
      serviceTo: invoice.serviceTo,
      paymentTermDays: 0,
      format: invoice.format,
      note: "",
      taxTreatment: invoice.taxTreatment,
      exemptionReason: invoice.exemptionReason,
      priceMode: invoice.priceMode,
      language: invoice.language,
      lines: negatedLines(lines),
    },
    { kind: "korrektur", correctsId: invoice.id },
  );
}

/** Nächste Rechnungsnummer des Jahres, z. B. um nach Lexoffice nahtlos weiterzuzählen. */
export async function numbering(year: number) {
  const [counter] = await db.select().from(schema.invoiceNumberCounters).where(eq(schema.invoiceNumberCounters.year, year));
  const last = counter?.last ?? 0;
  return { year, last, next: formatInvoiceNumber(year, last + 1) };
}

export async function setNextNumber(actor: string, year: number, next: number) {
  const result = await withActor(actor, (tx) => setNextCounter(tx, "rechnung", year, next));
  if (!result.ok) throw new InvoiceError(`Die nächste Nummer muss größer als ${formatInvoiceNumber(year, result.last)} sein.`);
}

/** Kennzahlen für die Übersicht */
export async function invoiceSummary(today: string) {
  const list = await listInvoices(today);
  const open = list.filter((i) => i.kind === "rechnung" && i.open !== 0);
  const openIds = new Set(open.map((i) => i.id));
  // Offene Korrekturen mindern die Forderung ihrer Rechnung
  const corrections = list.filter((i) => i.kind === "korrektur" && i.open !== 0 && i.correctsId && openIds.has(i.correctsId));
  const month = today.slice(0, 7);
  const previousMonth = (() => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const finals = list.filter((i) => i.status === "final" && i.listStatus !== "storniert" && i.kind !== "storno");
  const revenue = (prefix: string) =>
    finals.filter((i) => i.issueDate.startsWith(prefix)).reduce((sum, i) => sum + i.net, 0);
  return {
    openTotal: [...open, ...corrections].reduce((sum, i) => sum + i.open, 0),
    openCount: open.length,
    overdueCount: open.filter((i) => i.listStatus === "ueberfaellig").length,
    revenueMonth: { key: month, net: revenue(month) },
    revenuePreviousMonth: { key: previousMonth, net: revenue(previousMonth) },
    recent: list.filter((i) => i.status === "final").slice(0, 5),
    drafts: list.filter((i) => i.status === "draft").length,
  };
}

