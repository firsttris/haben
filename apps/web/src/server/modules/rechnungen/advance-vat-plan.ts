import { advanceVatPlan, recordedTaxShares, type AdvanceVatEvent, type AdvanceVatChange } from "@haben/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";
import { invoiceVatDate, invoiceVatMode, managedAdvance } from "./invoice-vat.ts";

type Invoice = typeof schema.invoices.$inferSelect;

/** Festgeschriebene Korrektur- und Stornokette, ohne irgendeinen alten Beleg zu verändern. */
async function family(originalId: string, q: Db | Tx): Promise<Invoice[]> {
  const ids = await q.execute<{ id: string }>(sql`with recursive chain as (
    select id from invoices where id = ${originalId}
    union select i.id from invoices i join chain c on i.corrects_id = c.id where i.status = 'final'
  ) select id from chain`);
  return q
    .select()
    .from(schema.invoices)
    .where(
      inArray(
        schema.invoices.id,
        [...ids].map((r) => r.id),
      ),
    );
}

async function paymentEvents(invoices: Invoice[], q: Db | Tx): Promise<AdvanceVatEvent[]> {
  const ids = invoices.map((i) => i.id);
  const totals = await invoiceTotalsById(ids, q);
  const rows = await q.execute<{
    invoice_id: string;
    date: string;
    amount: number;
    tax_shares: typeof schema.allocations.$inferSelect.taxShares;
    tax_shares_invoice_id: string | null;
    written_off: boolean;
  }>(sql`select a.invoice_id, b.booking_date::text as date, a.amount, a.tax_shares, a.tax_shares_invoice_id, false as written_off
    from allocations a join bank_transactions b on b.id = a.transaction_id where a.invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, false from cash_entries where invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, true from write_offs where invoice_id in ${ids}`);
  return [...rows].map((r) => ({
    date: r.date,
    [r.written_off ? "writtenOff" : "paid"]: recordedTaxShares(
      totals.get(r.invoice_id)!,
      r.amount,
      r.tax_shares_invoice_id === r.invoice_id ? r.tax_shares : null,
    ),
  }));
}

/** Der Leistungszeitpunkt einer Schlussrechnung und ihre spätere Aufhebung sind eigenständige Ereignisse. */
async function performanceEvents(original: Invoice, q: Db | Tx): Promise<AdvanceVatEvent[]> {
  const finals = await q
    .selectDistinct({ invoice: schema.invoices })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(and(eq(schema.invoiceLines.deductionOf, original.id), eq(schema.invoices.kind, "rechnung"), eq(schema.invoices.status, "final")));
  const events: AdvanceVatEvent[] = [];
  for (const { invoice } of finals) {
    if ((await invoiceVatMode(invoice, q)) !== "soll") continue;
    events.push({ date: await invoiceVatDate(invoice, q), performance: 1 });
    const cancellations = await q
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
    events.push(...cancellations.map((c) => ({ date: c.issueDate, performance: -1 as const })));
  }
  return events;
}

export interface ManagedAdvancePlan {
  original: Invoice;
  invoiceIds: Set<string>;
  changes: AdvanceVatChange[];
}

/** Gegenprobe aus den Nebenbüchern, ausdrücklich ohne Journalzeilen zu lesen. */
export async function loadAdvanceVatPlan(original: Invoice, q: Db | Tx = db): Promise<ManagedAdvancePlan> {
  const invoices = await family(original.id, q);
  const totals = await invoiceTotalsById(
    invoices.map((i) => i.id),
    q,
  );
  const events = await paymentEvents(invoices, q);
  events.push(...(await performanceEvents(original, q)));
  for (const invoice of invoices) {
    if (invoice.id !== original.id) events.push({ date: invoice.issueDate, correction: totals.get(invoice.id)!.taxes });
  }
  return { original, invoiceIds: new Set(invoices.map((i) => i.id)), changes: advanceVatPlan(totals.get(original.id)!.taxes, events) };
}

/** Nur neue Anzahlungen: Bestandsbelege laufen unverändert durch ihre bisherigen Nebenbücher. */
export async function advanceVatPlans(q: Db | Tx = db): Promise<ManagedAdvancePlan[]> {
  const originals = await q
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.advanceType, "anzahlung"), eq(schema.invoices.status, "final")));
  const plans: ManagedAdvancePlan[] = [];
  for (const invoice of originals) if (await managedAdvance(invoice, q)) plans.push(await loadAdvanceVatPlan(invoice, q));
  return plans;
}
