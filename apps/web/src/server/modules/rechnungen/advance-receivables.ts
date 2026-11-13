import { advanceReceivables, recordedTaxShares, type DeferredSettlement } from "@haben/core";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";

/** Die tatsächlichen Datums-/Centwerte derselben Nebenbücher; ein späterer Zuordnungszeitpunkt ist kein Zuflussdatum. */
async function settlementsAt(ids: string[], cutoff: string, q: Db | Tx): Promise<DeferredSettlement[]> {
  const totals = await invoiceTotalsById(ids, q);
  const rows = await q.execute<{
    invoice_id: string;
    date: string;
    amount: number;
    kind: "payment" | "writeOff";
    tax_shares: typeof schema.allocations.$inferSelect.taxShares;
    tax_shares_invoice_id: string | null;
  }>(sql`select a.invoice_id,b.booking_date::text as date,a.amount,'payment' as kind,a.tax_shares,a.tax_shares_invoice_id
    from allocations a join bank_transactions b on b.id=a.transaction_id where a.invoice_id in ${ids} and b.booking_date <= ${cutoff}
    union all select invoice_id,date::text,amount,'payment',tax_shares,tax_shares_invoice_id
      from cash_entries where invoice_id in ${ids} and date <= ${cutoff}
    union all select invoice_id,date::text,amount,'writeOff',tax_shares,tax_shares_invoice_id
      from write_offs where invoice_id in ${ids} and date <= ${cutoff}`);
  return [...rows].map((row) => ({
    invoiceId: row.invoice_id,
    date: row.date,
    amount: row.amount,
    kind: row.kind,
    net: recordedTaxShares(totals.get(row.invoice_id)!, row.amount, row.tax_shares_invoice_id === row.invoice_id ? row.tax_shares : null).reduce(
      (sum, share) => sum + share.base,
      0,
    ),
  }));
}

/** Nur der additive Bilanzweg; Quelle für OPOS, Journalgegenprobe und Restlaufzeiten. */
export async function advanceReceivablesAt(cutoff: string, q: Db | Tx = db) {
  const i = schema.invoices;
  const invoices = await q
    .select({
      id: i.id,
      correctsId: i.correctsId,
      replacesInvoiceId: i.replacesInvoiceId,
      kind: i.kind,
      variant: i.variant,
      advanceType: i.advanceType,
      number: sql<string>`coalesce(${i.number},'')`,
      party: sql<string>`coalesce(${i.buyer}->>'name',${schema.contacts.name},'–')`,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      serviceFrom: i.serviceFrom,
      serviceTo: i.serviceTo,
      gross: i.gross,
    })
    .from(i)
    .leftJoin(schema.contacts, eq(schema.contacts.id, i.contactId))
    .where(and(eq(i.status, "final"), eq(i.advanceAccounting, "deferred")))
    .orderBy(asc(i.createdAt), asc(i.id));
  const ids = invoices.map((i) => i.id);
  if (!ids.length) return advanceReceivables([], [], [], cutoff);
  const deductions = await q
    .select({ invoiceId: schema.invoiceLines.invoiceId, advanceId: schema.invoiceLines.deductionOf })
    .from(schema.invoiceLines)
    .where(and(inArray(schema.invoiceLines.invoiceId, ids), isNotNull(schema.invoiceLines.deductionOf)));
  return advanceReceivables(
    invoices.map(({ serviceTo, serviceFrom, ...invoice }) => ({ ...invoice, performanceDate: serviceTo ?? serviceFrom ?? invoice.issueDate })),
    await settlementsAt(ids, cutoff, q),
    deductions.map((d) => ({ ...d, advanceId: d.advanceId! })),
    cutoff,
  );
}
