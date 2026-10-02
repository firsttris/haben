import {
  computeEuer,
  computeInvoiceTotals,
  EXPENSE_CATEGORIES,
  type EuerPayment,
  type EuerResult,
  type ExpenseCategory,
  type InvoiceTotals,
} from "@haben/core";
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { depreciationForEuer, withdrawalsForEuer } from "./assets.ts";
import { db, schema } from "./db/index.ts";

const isCategory = (value: string | null): value is ExpenseCategory => value !== null && value in EXPENSE_CATEGORIES;

/** Summen aus den Beträgen eines Belegs je Steuersatz */
function documentTotals(amounts: { taxRate: number; net: number; tax: number }[]): InvoiceTotals {
  const taxes = [...amounts].sort((a, b) => b.taxRate - a.taxRate).map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax }));
  const net = taxes.reduce((s, t) => s + t.base, 0);
  const tax = taxes.reduce((s, t) => s + t.tax, 0);
  return { net, tax, gross: net + tax, taxes };
}

async function invoiceTotalsById(ids: string[]): Promise<Map<string, InvoiceTotals>> {
  if (ids.length === 0) return new Map();
  const lines = await db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, ids));
  return new Map(
    ids.map((id) => [
      id,
      computeInvoiceTotals(lines.filter((l) => l.invoiceId === id).map((l) => ({ ...l, taxRate: l.taxRate as 1900 | 700 | 0 }))),
    ]),
  );
}

async function documentTotalsById(ids: string[]): Promise<Map<string, InvoiceTotals>> {
  if (ids.length === 0) return new Map();
  const amounts = await db.select().from(schema.documentAmounts).where(inArray(schema.documentAmounts.documentId, ids));
  return new Map(ids.map((id) => [id, documentTotals(amounts.filter((a) => a.documentId === id))]));
}

/**
 * Alle Zahlungen eines Jahres für die EÜR: Zuordnungen im Bankabgleich nach Buchungsdatum
 * des Umsatzes, privat bezahlte Belege nach Belegdatum. Privat und Geldtransit sind nicht
 * betrieblich und fehlen deshalb.
 */
export async function euerPayments(year: number): Promise<EuerPayment[]> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const allocations = await db
    .select({
      kind: schema.allocations.kind,
      amount: schema.allocations.amount,
      invoiceId: schema.allocations.invoiceId,
      documentId: schema.allocations.documentId,
      transactionId: schema.allocations.transactionId,
      date: schema.bankTransactions.bookingDate,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
      treatment: schema.invoices.taxTreatment,
    })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
    .where(
      and(
        gte(schema.bankTransactions.bookingDate, start),
        lt(schema.bankTransactions.bookingDate, end),
        inArray(schema.allocations.kind, ["invoice", "document", "ustVorauszahlung", "gebuehren"]),
      ),
    );

  const privateDocs = await db
    .select({
      id: schema.documents.id,
      date: schema.documents.documentDate,
      gross: schema.documents.gross,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        eq(schema.documents.payment, "privat"),
        isNotNull(schema.documents.documentDate),
        gte(schema.documents.documentDate, start),
        lt(schema.documents.documentDate, end),
      ),
    );

  const invoiceTotals = await invoiceTotalsById([...new Set(allocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])))]);
  const docTotals = await documentTotalsById([
    ...new Set([...allocations.flatMap((a) => (a.documentId ? [a.documentId] : [])), ...privateDocs.map((d) => d.id)]),
  ]);

  const payments: EuerPayment[] = [];
  for (const a of allocations) {
    // Zuordnung und Gegenzeile hängen am selben Umsatz und heben sich so exakt auf
    const group = `${a.transactionId}|${a.invoiceId ?? a.documentId ?? a.kind}`;
    if (a.kind === "invoice" && a.invoiceId) {
      payments.push({
        kind: "invoice",
        date: a.date,
        paid: a.amount,
        totals: invoiceTotals.get(a.invoiceId)!,
        treatment: a.treatment ?? "regulaer",
        group,
      });
    } else if (a.kind === "document" && a.documentId) {
      payments.push({
        kind: "document",
        date: a.date,
        paid: -a.amount,
        totals: docTotals.get(a.documentId)!,
        category: isCategory(a.category) ? a.category : "sonstiges",
        vorsteuerAbzug: a.vorsteuerAbzug ?? true,
        privateShare: a.privateShare ?? 0,
        group,
      });
    } else if (a.kind === "ustVorauszahlung" || a.kind === "gebuehren") {
      payments.push({ kind: a.kind, date: a.date, amount: a.amount, group });
    }
  }
  for (const d of privateDocs) {
    payments.push({
      kind: "document",
      date: d.date!,
      paid: d.gross,
      totals: docTotals.get(d.id)!,
      category: isCategory(d.category) ? d.category : "sonstiges",
      vorsteuerAbzug: d.vorsteuerAbzug,
      privateShare: d.privateShare,
    });
  }
  return payments;
}

export async function euerForYear(year: number): Promise<EuerResult> {
  return computeEuer(year, await euerPayments(year), await depreciationForEuer(year), await withdrawalsForEuer(year));
}

export interface OpenPosition {
  id: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  gross: number;
  open: number;
  /** Tage seit Fälligkeit; 0 = heute fällig, negativ = noch nicht fällig */
  daysOverdue: number;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function paidSums(column: typeof schema.allocations.invoiceId | typeof schema.allocations.documentId, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ id: column, paid: sql<string>`sum(${schema.allocations.amount})` })
    .from(schema.allocations)
    .where(inArray(column, ids))
    .groupBy(column);
  return new Map(rows.map((r) => [r.id!, Number(r.paid)]));
}

/**
 * Offene Forderungen (festgeschriebene Rechnungen und Korrekturen, nicht storniert) und offene
 * Verbindlichkeiten (gebuchte, über die Bank zu zahlende Belege), nach Fälligkeit sortiert.
 */
export async function openPositions(today: string) {
  const invoices = await db
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "final"), inArray(schema.invoices.kind, ["rechnung", "korrektur"])));
  const cancelled = new Set(
    (
      await db
        .select({ id: schema.invoices.correctsId })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")))
    ).map((r) => r.id),
  );
  const invoicePaid = await paidSums(schema.allocations.invoiceId, invoices.map((i) => i.id));
  const receivables: OpenPosition[] = invoices
    .filter((i) => !cancelled.has(i.id))
    .map((i) => ({
      id: i.id,
      number: i.number ?? "",
      party: i.buyerName ?? "–",
      date: i.issueDate,
      dueDate: i.dueDate,
      gross: i.gross,
      open: i.gross - (invoicePaid.get(i.id) ?? 0),
      daysOverdue: daysBetween(i.dueDate, today),
    }))
    .filter((i) => i.open !== 0);

  const documents = await db
    .select({
      id: schema.documents.id,
      number: schema.documents.invoiceNumber,
      supplier: schema.documents.supplierName,
      filename: schema.documents.filename,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      uploadedAt: schema.documents.uploadedAt,
      gross: schema.documents.gross,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank")));
  const documentPaid = await paidSums(schema.allocations.documentId, documents.map((d) => d.id));
  const payables: OpenPosition[] = documents
    .map((d) => {
      const date = d.documentDate ?? d.uploadedAt.toISOString().slice(0, 10);
      const dueDate = d.dueDate ?? date;
      // Zuordnungen tragen das Vorzeichen des Kontos (Ausgang negativ)
      return {
        id: d.id,
        number: d.number || d.filename,
        party: d.supplier || "–",
        date,
        dueDate,
        gross: d.gross,
        open: d.gross + (documentPaid.get(d.id) ?? 0),
        daysOverdue: daysBetween(dueDate, today),
      };
    })
    .filter((d) => d.open !== 0);

  const byDue = (a: OpenPosition, b: OpenPosition) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number);
  receivables.sort(byDue);
  payables.sort(byDue);
  const total = (items: OpenPosition[]) => items.reduce((s, i) => s + i.open, 0);
  const overdue = (items: OpenPosition[]) => items.filter((i) => i.daysOverdue > 0);
  return {
    receivables,
    payables,
    receivablesTotal: total(receivables),
    payablesTotal: total(payables),
    receivablesOverdue: total(overdue(receivables)),
    payablesOverdue: total(overdue(payables)),
  };
}

export type OpenPositions = Awaited<ReturnType<typeof openPositions>>;

/** Jahre mit Bankumsätzen, Rechnungen oder Belegen, für die Jahresauswahl */
export async function reportYears(): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(sql`
    select distinct extract(year from d)::int as year from (
      select booking_date as d from bank_transactions
      union all select issue_date from invoices where status = 'final'
      union all select document_date from documents where status = 'gebucht' and document_date is not null
    ) dates order by 1`);
  return [...rows].map((r) => Number(r.year));
}
