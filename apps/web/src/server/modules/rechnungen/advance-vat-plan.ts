import {
  advanceBalancePlan,
  advanceUsesPayments,
  advanceVatPlan,
  recordedTaxShares,
  type AdvanceBalanceChange,
  type AdvanceBalanceEvent,
  type AdvanceVatEvent,
  type AdvanceVatChange,
} from "@haben/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";
import { invoiceTaxReader } from "./invoice-tax.ts";
import { UserError } from "../../errors.ts";

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

async function paymentEvents(invoices: Invoice[], q: Db | Tx): Promise<AdvanceBalanceEvent[]> {
  const ids = invoices.map((i) => i.id);
  const totals = await invoiceTotalsById(ids, q);
  const rows = await q.execute<{
    invoice_id: string;
    date: string;
    amount: number;
    tax_shares: typeof schema.allocations.$inferSelect.taxShares;
    tax_shares_invoice_id: string | null;
    written_off: boolean;
    kind: "skonto" | "forderungsausfall" | null;
  }>(sql`select a.invoice_id, b.booking_date::text as date, a.amount, a.tax_shares, a.tax_shares_invoice_id, false as written_off
    , null::text as kind
    from allocations a join bank_transactions b on b.id = a.transaction_id where a.invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, false, null from cash_entries where invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, true, kind from write_offs where invoice_id in ${ids}`);
  return [...rows].map((r) => ({
    date: r.date,
    ...(r.kind ? { kind: r.kind } : {}),
    [r.written_off ? "writtenOff" : "paid"]: recordedTaxShares(
      totals.get(r.invoice_id)!,
      r.amount,
      r.tax_shares_invoice_id === r.invoice_id ? r.tax_shares : null,
    ),
  }));
}

/** Beim neuen Bilanzverfahren bleibt eine tatsächlich erbrachte Leistung auch nach bloßem Rechnungsaustausch bestehen. */
async function performanceEvents(original: Invoice, q: Db | Tx, taxes: ReturnType<typeof invoiceTaxReader>) {
  const finals = await q
    .selectDistinct({ invoice: schema.invoices })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(and(eq(schema.invoiceLines.deductionOf, original.id), eq(schema.invoices.kind, "rechnung"), eq(schema.invoices.status, "final")));
  const events: AdvanceVatEvent[] = [];
  const balanceEvents: AdvanceBalanceEvent[] = [];
  for (const { invoice } of finals) {
    if (original.advanceAccounting === "deferred") {
      // Ein Ersatz dokumentiert denselben Leistungsstand, nicht eine zweite Ausführung.
      if (invoice.replacesInvoiceId) continue;
      const date = invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate;
      balanceEvents.push({ date, performance: 1 });
      if ((await taxes.companyMode(invoice)) === "soll") events.push({ date, performance: 1 });
      continue;
    }
    if ((await taxes.companyMode(invoice)) !== "soll") continue;
    events.push({ date: await taxes.date(invoice), performance: 1 });
    const cancellations = await q
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
    events.push(...cancellations.map((c) => ({ date: c.issueDate, performance: -1 as const })));
  }
  return { vat: events, balance: balanceEvents };
}

export interface ManagedAdvancePlan {
  original: Invoice;
  invoiceIds: Set<string>;
  changes: AdvanceVatChange[];
  balanceChanges: AdvanceBalanceChange[];
}

/** Gegenprobe aus den Nebenbüchern, ausdrücklich ohne Journalzeilen zu lesen. */
export async function loadAdvanceVatPlan(reference: Pick<Invoice, "id">, q: Db | Tx = db, taxes = invoiceTaxReader(q)): Promise<ManagedAdvancePlan> {
  // Die Festschreibung kann den Verfahrensmarker gerade erst gesetzt haben; der Vorher-Lader hält noch den Entwurf.
  const [original] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, reference.id));
  if (!original) throw new UserError("Die ursprüngliche Anzahlungsrechnung fehlt.");
  const invoices = await family(original.id, q);
  const totals = await invoiceTotalsById(
    invoices.map((i) => i.id),
    q,
  );
  const events = await paymentEvents(invoices, q);
  const performance = await performanceEvents(original, q, taxes);
  for (const invoice of invoices) {
    if (invoice.id !== original.id) events.push({ date: invoice.issueDate, correction: totals.get(invoice.id)!.taxes });
  }
  const total = totals.get(original.id)!.taxes;
  const [company] = await q.select({ kontenrahmen: schema.company.kontenrahmen }).from(schema.company).where(eq(schema.company.id, 1));
  return {
    original,
    invoiceIds: new Set(invoices.map((i) => i.id)),
    changes: advanceUsesPayments(original.taxTreatment) ? advanceVatPlan(total, [...events, ...performance.vat]) : [],
    balanceChanges:
      original.advanceAccounting === "deferred"
        ? advanceBalancePlan(total, [...events, ...performance.balance], company!.kontenrahmen, original.taxTreatment)
        : [],
  };
}

/** Nur neue Anzahlungen: Bestandsbelege laufen unverändert durch ihre bisherigen Nebenbücher. */
export async function advanceVatPlans(q: Db | Tx, year: number, taxes = invoiceTaxReader(q)): Promise<ManagedAdvancePlan[]> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  // Vorjahresanzahlungen zählen, wenn im Zieljahr Zahlung, Korrektur oder Schlussleistung anfällt. Nicht die komplette
  // Historie je Quartal ausrechnen: Nur Kandidaten-IDs ermitteln, dann deren zusammenhängenden Plan laden.
  const candidates = await q.execute<{ id: string }>(sql`with recursive family(root_id, id) as (
    select id, id from invoices where advance_type = 'anzahlung' and status = 'final'
      and tax_treatment in ('regulaer', 'steuerfrei', 'ausfuhr')
    union all select f.root_id, i.id from family f join invoices i on i.corrects_id = f.id where i.status = 'final'
  ), relevant as (
    select f.root_id from family f join invoices i on i.id = f.id where i.issue_date >= ${start} and i.issue_date < ${end}
    union select f.root_id from family f join allocations a on a.invoice_id = f.id
      join bank_transactions b on b.id = a.transaction_id where b.booking_date >= ${start} and b.booking_date < ${end}
    union select f.root_id from family f join cash_entries c on c.invoice_id = f.id where c.date >= ${start} and c.date < ${end}
    union select f.root_id from family f join write_offs w on w.invoice_id = f.id where w.date >= ${start} and w.date < ${end}
    union select f.root_id from family f join invoice_lines l on l.deduction_of = f.id
      join invoices i on i.id = l.invoice_id and i.status = 'final'
      left join invoices c on c.corrects_id = i.id and c.kind = 'storno' and c.status = 'final'
      where (coalesce(i.service_to, i.service_from, i.issue_date) >= ${start} and coalesce(i.service_to, i.service_from, i.issue_date) < ${end})
        or (c.issue_date >= ${start} and c.issue_date < ${end})
  ) select distinct root_id as id from relevant`);
  if (!candidates.length) return [];
  const originals = await q
    .select()
    .from(schema.invoices)
    .where(
      inArray(
        schema.invoices.id,
        [...candidates].map((c) => c.id),
      ),
    );
  return Promise.all(originals.map((invoice) => loadAdvanceVatPlan(invoice, q, taxes)));
}
