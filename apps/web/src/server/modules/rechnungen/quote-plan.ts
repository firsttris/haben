import { UserError } from "../../errors.ts";
import {
  orderRateAmounts,
  planProblem,
  planProgress,
  planRowStatus,
  planSchedule,
  type PaymentPlanRow,
  type PlanRowStatus,
  type ScheduledRow,
  type UnitLabel,
} from "@haben/core";
import { texts } from "@haben/einvoice";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { listInvoices, type Invoice } from "./invoices.ts";
import { getQuote, orderCalculation, quoteToInvoice, type AbschlagPlanLines, type Quote, type QuoteLine } from "./quotes.ts";

/*
 * Abschläge aus dem Zahlungsplan eines Angebots: je Zeile eine Abschlagsrechnung mit Kunde, Preismodus und
 * Umsatzsteuer-Behandlung aus dem Angebot und je Steuersatz einer Position, anteilig aus dem Auftrag nach der Auswahl des
 * Kunden (planSchedule in packages/core). Die letzte Zeile (Rest) rechnet die Schlussrechnung ab. Dazu die Übersicht je
 * Zeile mit Status, Plan und Ist und der Fortschritt „Abgerechnet X von Y“.
 */

export class PlanError extends UserError {}

/** Zeilen des Plans mit Beträgen, gerechnet auf den Auftrag nach der Auswahl */
function scheduleFor(quote: Quote, lines: QuoteLine[], choices: number[]): { rows: ScheduledRow[]; total: number; gross: number } {
  const { totals } = orderCalculation(quote, lines, choices);
  const amounts = orderRateAmounts(totals, quote.priceMode);
  return { rows: planSchedule(quote.paymentPlan, amounts, quote.priceMode), total: amounts.reduce((s, a) => s + a.amount, 0), gross: totals.gross };
}

/** Text der Position, z. B. „2. Abschlag 40 % gemäß Angebot AN-2026-004 vom 01.10.2026“ */
function abschlagText(quote: Quote, row: PaymentPlanRow, index: number): string {
  const t = texts(quote.language);
  const share = row.share.kind === "prozent" ? t.percent(row.share.value) : null;
  return t.planAbschlag(index + 1, row.label, share, quote.number ?? "", t.date(quote.issueDate));
}

/** Nicht stornierte Rechnung zu einer Zeile des Plans; je Zeile gibt es höchstens eine */
async function rowInvoice(tx: Tx, quoteId: string, row: number) {
  const [invoice] = await tx
    .select({ number: schema.invoices.number })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.quoteId, quoteId),
        eq(schema.invoices.paymentPlanRow, row),
        sql`not exists (select 1 from invoices s where s.corrects_id = ${schema.invoices.id} and s.kind = 'storno' and s.status = 'final')`,
      ),
    )
    .limit(1);
  return invoice ?? null;
}

/** Positionen der Abschlagsrechnung zu Zeile `row`: je Steuersatz eine, im Preismodus des Angebots */
function planLinesFor(row: number) {
  return async (tx: Tx, quote: Quote, lines: QuoteLine[], choices: number[]): Promise<AbschlagPlanLines> => {
    const plan = quote.paymentPlan[row];
    if (!plan) throw new PlanError("Diese Zeile gibt es im Zahlungsplan nicht.");
    if (plan.share.kind === "rest") throw new PlanError("Den Rest rechnest du mit der Schlussrechnung ab.");
    const schedule = scheduleFor(quote, lines, choices);
    const problem = planProblem(quote.paymentPlan, schedule.total);
    if (problem) throw new PlanError(`Nach der Auswahl der Positionen: ${problem}.`);
    const existing = await rowInvoice(tx, quote.id, row);
    if (existing) throw new PlanError(`Zu Zeile ${row + 1} gibt es schon ${existing.number ? `die Abschlagsrechnung ${existing.number}` : "einen Entwurf"}.`);
    const description = abschlagText(quote, plan, row);
    return {
      row,
      lines: schedule.rows[row]!.rates.filter((r) => r.amount !== 0).map((r) => ({
        description,
        quantity: 1000,
        unit: "Psch." as UnitLabel,
        unitPrice: r.amount,
        taxRate: r.rate as 1900 | 700 | 0,
      })),
    };
  };
}

/** Abschlagsrechnung zu einer Zeile des Zahlungsplans; mit `choices` hält sie vorher die Auswahl des Kunden fest */
export async function abschlagFromPlan(actor: string, quoteId: string, today: string, row: number, choices: number[] | null): Promise<Invoice> {
  return quoteToInvoice(actor, quoteId, today, "abschlag", { choices, planLines: planLinesFor(row) });
}

export interface PlanRowOverview extends ScheduledRow {
  index: number;
  status: PlanRowStatus;
  /** Nicht stornierte Rechnung zur Zeile (Abschlag bzw. beim Rest die Schlussrechnung) */
  invoice: { id: string; number: string | null; gross: number } | null;
}

/** Übersicht des Zahlungsplans auf dem Angebot; null ohne Plan */
export async function quotePlanOverview(quoteId: string, today: string) {
  const data = await getQuote(quoteId);
  if (!data || data.quote.paymentPlan.length === 0) return null;
  const { quote, lines, choices, billing } = data;
  const schedule = scheduleFor(quote, lines, choices);
  const live = billing.filter((b) => !b.cancelled);
  const open = new Map((await Promise.all(live.filter((b) => b.status === "final").map((b) => listInvoices(today, b.id)))).flat().map((i) => [i.id, i.open]));
  const forRow = (row: ScheduledRow, index: number) =>
    billing.filter((b) => (row.share.kind === "rest" ? b.variant !== "abschlag" : b.variant === "abschlag" && b.paymentPlanRow === index));
  const rows: PlanRowOverview[] = schedule.rows.map((row, index) => {
    const invoices = forRow(row, index);
    const current = invoices.find((b) => !b.cancelled && b.status === "final") ?? invoices.find((b) => !b.cancelled) ?? null;
    return {
      ...row,
      index,
      status: planRowStatus(invoices.map((b) => ({ status: b.status, cancelled: b.cancelled, open: open.get(b.id) ?? b.gross }))),
      invoice: current ? { id: current.id, number: current.number, gross: current.gross } : null,
    };
  });
  const billed = live.filter((b) => b.status === "final").reduce((s, b) => s + b.gross, 0);
  return { rows, progress: planProgress(billed, schedule.gross), problem: planProblem(quote.paymentPlan, schedule.total) };
}
