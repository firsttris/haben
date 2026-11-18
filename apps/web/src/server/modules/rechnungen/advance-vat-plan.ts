import {
  advanceBalancePlan,
  advanceUsesPayments,
  isKapitalgesellschaft,
  advanceVatSchedule,
  advanceVatDifference,
  recordedTaxShares,
  type AdvanceBalanceChange,
  type AdvanceBalanceEvent,
  type AdvanceVatEvent,
  type AdvanceVatChange,
  type TaxShare,
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

const negate = (shares: readonly TaxShare[]) => shares.map((share) => ({ ...share, base: -share.base, tax: -share.tax }));

/** Korrektur ohne Kennzeichen (vor #853 festgeschrieben): ihre Minderung wirkte schon mit dem Beleg. */
const legacy = (invoice: Invoice) => invoice.kind !== "rechnung" && invoice.reductionRule === null;

async function paymentEvents(invoices: Invoice[], q: Db | Tx): Promise<AdvanceBalanceEvent[]> {
  const ids = invoices.map((i) => i.id);
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const totals = await invoiceTotalsById(ids, q);
  const rows = await q.execute<{
    invoice_id: string;
    date: string;
    amount: number;
    tax_shares: typeof schema.allocations.$inferSelect.taxShares;
    tax_shares_invoice_id: string | null;
    source: "payment" | "write_off" | "settlement";
    kind: "skonto" | "forderungsausfall" | null;
  }>(sql`select a.invoice_id, coalesce(a.date, b.booking_date)::text as date, a.amount, a.tax_shares, a.tax_shares_invoice_id, 'payment' as source
    , null::text as kind
    from allocations a join bank_transactions b on b.id = a.transaction_id where a.invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, 'payment', null from cash_entries where invoice_id in ${ids}
    union all select invoice_id, date::text, amount, tax_shares, tax_shares_invoice_id, 'write_off', kind from write_offs where invoice_id in ${ids}
    union all select invoice_id, date::text, amount, null, null, 'settlement', null from invoice_settlements where invoice_id in ${ids}`);
  return [...rows].flatMap((r) => {
    const shares = recordedTaxShares(totals.get(r.invoice_id)!, r.amount, r.tax_shares_invoice_id === r.invoice_id ? r.tax_shares : null);
    // Rückzahlung oder Verrechnung einer Korrektur ohne Kennzeichen tilgt deren Anspruch; Verrechnen ist kein Zufluss.
    const claim = legacy(byId.get(r.invoice_id)!) ? { legacyClaim: { id: r.invoice_id, shares } } : {};
    if (r.source === "settlement") return Object.keys(claim).length ? [{ date: r.date, ...claim }] : [];
    return [{ date: r.date, ...(r.kind ? { kind: r.kind } : {}), [r.source === "write_off" ? "writtenOff" : "paid"]: shares, ...claim }];
  });
}

/**
 * Storno und Korrektur der Kette. Gekennzeichnete halten bereits vereinnahmte Steuer bis zur Rückzahlung; ein Storno
 * einer Korrektur ohne Kennzeichen nimmt nur deren Anspruch zurück, nicht die Minderung anderer Korrekturen.
 */
function correctionEvents(original: Invoice, invoices: Invoice[], totals: Map<string, { taxes: TaxShare[] }>): AdvanceVatEvent[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  return invoices
    .filter((invoice) => invoice.id !== original.id)
    .map((invoice) => {
      const taxes = totals.get(invoice.id)!.taxes;
      const target = invoice.correctsId === original.id ? undefined : byId.get(invoice.correctsId!);
      const claimOf = legacy(invoice) ? invoice.id : target && legacy(target) ? target.id : null;
      return {
        date: invoice.issueDate,
        correction: taxes,
        ...(invoice.reductionRule === "rueckgewaehr" && claimOf === null ? { untilRefund: true } : {}),
        ...(claimOf ? { legacyClaim: { id: claimOf, shares: negate(taxes) } } : {}),
      };
    });
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
    if (original.advanceAccounting === "deferred" || invoice.advanceAccounting === "deferred") {
      // Ein Ersatz dokumentiert denselben Leistungsstand, nicht eine zweite Ausführung.
      if (invoice.replacesInvoiceId) continue;
      const date = invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate;
      // Die neue Schlussleistung besteht auch für abgezogene Altanzahlungen fort (§ 13 UStG); nur neue Originale
      // benötigen die Nettoabgrenzung. Alte Erlöse und Siegel bleiben erhalten. Entscheidung in #750:
      // https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
      // Steuerzeitpunkt: https://www.gesetze-im-internet.de/ustg_1980/__13.html
      if (original.advanceAccounting === "deferred") balanceEvents.push({ date, performance: 1 });
      if (!advanceUsesPayments(original.taxTreatment) || (await taxes.companyMode(invoice)) === "soll") {
        events.push({ date: advanceUsesPayments(original.taxTreatment) ? date : await taxes.date(invoice), performance: 1 });
      }
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
  /**
   * „advance“: neue Anzahlung oder Vorauszahlung, deren Steuer allein dieser Plan bucht. „refund“: Rechnung mit
   * normalen Soll-Buchungen; der Plan ergänzt nur die bis zur Rückzahlung gehaltene Steuer gekennzeichneter Korrekturen.
   */
  kind: "advance" | "refund";
  /** Belege, deren normale Zahlungs- und Rechnungszeilen der Plan ersetzt; bei „refund“ keine */
  invoiceIds: Set<string>;
  changes: AdvanceVatChange[];
  /** Sonderumsätze: normale Ausbuchungsbasis abziehen, damit deren Neutralisierung nicht doppelt gemeldet wird. */
  postingChanges: AdvanceVatChange[];
  balanceChanges: AdvanceBalanceChange[];
}

/**
 * Rechnung mit normalen Buchungen, auch ein Teilleistungs-Abschlag: Erstattungsregel nur als Ergänzung
 * (ManagedAdvancePlan, „refund“). Anzahlungen versteuert ihr eigener Plan.
 */
export const refundOnly = (original: Pick<Invoice, "advanceType" | "advanceAccounting" | "variant">) =>
  original.advanceType !== "anzahlung" && (original.advanceAccounting === null || original.variant === "schluss");

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
  const total = totals.get(original.id)!.taxes;
  if (refundOnly(original)) {
    // Nur Soll braucht die Ergänzung: Bei Ist bucht schon die Rückzahlung die Steuer zurück (§ 13 Abs. 1 Nr. 1 b UStG).
    // Papierstornos einer Schlusskette (#750) buchen nichts und mindern deshalb auch nichts.
    const posted: Invoice[] = [];
    for (const invoice of invoices) if (await taxes.invoicePostingAllowed(invoice)) posted.push(invoice);
    const held =
      original.status === "final" && advanceUsesPayments(original.taxTreatment) && (await taxes.companyMode(original)) === "soll"
        ? advanceVatSchedule(total, [...events, ...correctionEvents(original, posted, totals)], "held")
        : [];
    return { original, kind: "refund", invoiceIds: new Set(), changes: held, postingChanges: held, balanceChanges: [] };
  }
  const normal = original.variant === null && original.advanceAccounting === "deferred";
  const cancellation = normal ? invoices.find((invoice) => invoice.kind === "storno" && invoice.correctsId === original.id) : undefined;
  // Ein Storno vor der Leistung hebt auch die bereits vordatierte Realisierung durch neue Gegenbuchungen auf.
  // Nach Leistung bleiben echte Entgeltkorrekturen datiert; erhaltene Zahlungen bleiben bis zur Rückzahlung besteuert
  // (advanceVatSchedule). Die Papier-Schlusskette aus #750 behält ihren eigenen bestätigten Ablauf.
  const performed =
    original.status === "final" && original.serviceDate && (!cancellation || cancellation.issueDate > original.serviceDate)
      ? [{ date: original.serviceDate, performance: 1 as const }]
      : [];
  const performance = normal
    ? {
        vat:
          (await taxes.companyMode(original)) === "soll"
            ? [...performed, ...(performed.length && cancellation ? [{ date: cancellation.issueDate, performance: -1 as const }] : [])]
            : [],
        balance: performed,
      }
    : await performanceEvents(original, q, taxes);
  events.push(...correctionEvents(original, invoices, totals));
  const [company] = await q
    .select({ kontenrahmen: schema.company.kontenrahmen, rechtsform: schema.company.rechtsform })
    .from(schema.company)
    .where(eq(schema.company.id, 1));
  // Sonderumsätze verwenden denselben Plan, aber keine Zahlungsereignisse (§ 18b UStG).
  const special = original.advanceAccounting === "deferred" && ["reverse_charge", "ig_lieferung", "drittland"].includes(original.taxTreatment);
  const changes = advanceUsesPayments(original.taxTreatment)
    ? advanceVatSchedule(total, [...events, ...performance.vat])
    : special
      ? advanceVatSchedule(total, [...events.filter((event) => !event.paid), ...performance.vat])
      : [];
  const normalWriteOffs = events.flatMap((event) =>
    event.writtenOff?.length ? [{ date: event.date, shares: event.writtenOff.map((share) => ({ ...share, base: -share.base, tax: -share.tax })) }] : [],
  );
  return {
    original,
    kind: "advance",
    invoiceIds: new Set(invoices.map((i) => i.id)),
    changes,
    postingChanges: special ? advanceVatDifference(normalWriteOffs, changes) : changes,
    balanceChanges:
      original.advanceAccounting === "deferred" && isKapitalgesellschaft(company!.rechtsform)
        ? advanceBalancePlan(total, [...events, ...performance.balance], company!.kontenrahmen, original.taxTreatment)
        : [],
  };
}

/** Neue Anzahlungen und gekennzeichnete Korrekturketten: Bestandsbelege laufen unverändert durch ihre bisherigen Nebenbücher. */
export async function advanceVatPlans(q: Db | Tx, year: number, taxes = invoiceTaxReader(q)): Promise<ManagedAdvancePlan[]> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  // Vorjahresanzahlungen zählen, wenn im Zieljahr Zahlung, Verrechnung, Korrektur oder Schlussleistung anfällt. Nicht die komplette
  // Historie je Quartal ausrechnen: Nur Kandidaten-IDs ermitteln, dann deren zusammenhängenden Plan laden.
  // Rechnungen mit normalen Buchungen nur, wenn ein Storno oder eine Korrektur das Kennzeichen „rueckgewaehr“ trägt.
  const candidates = await q.execute<{ id: string }>(sql`with recursive up(id, parent) as (
    select id, corrects_id from invoices where reduction_rule is not null and status = 'final'
    union select i.id, i.corrects_id from up join invoices i on i.id = up.parent
  ), family(root_id, id) as (
    select id, id from invoices where status = 'final' and (
      (advance_type = 'anzahlung' and (tax_treatment in ('regulaer', 'steuerfrei', 'ausfuhr')
        or (advance_accounting = 'deferred' and tax_treatment in ('reverse_charge', 'ig_lieferung', 'drittland'))))
      or (variant is null and corrects_id is null and advance_accounting = 'deferred')
      or (id in (select id from up where parent is null) and advance_type is distinct from 'anzahlung'
        and (advance_accounting is null or variant = 'schluss') and tax_treatment in ('regulaer', 'steuerfrei', 'ausfuhr'))
    )
    union all select f.root_id, i.id from family f join invoices i on i.corrects_id = f.id where i.status = 'final'
  ), relevant as (
    select f.root_id from family f join invoices i on i.id = f.id
      where (i.issue_date >= ${start} and i.issue_date < ${end}) or (i.service_date >= ${start} and i.service_date < ${end})
    union select f.root_id from family f join allocations a on a.invoice_id = f.id
      join bank_transactions b on b.id = a.transaction_id
      where coalesce(a.date, b.booking_date) >= ${start} and coalesce(a.date, b.booking_date) < ${end}
    union select f.root_id from family f join cash_entries c on c.invoice_id = f.id where c.date >= ${start} and c.date < ${end}
    union select f.root_id from family f join write_offs w on w.invoice_id = f.id where w.date >= ${start} and w.date < ${end}
    union select f.root_id from family f join invoice_settlements s on s.invoice_id = f.id where s.date >= ${start} and s.date < ${end}
    union select f.root_id from family f join invoice_lines l on l.deduction_of = f.id
      join invoices i on i.id = l.invoice_id and i.status = 'final'
      left join invoices c on c.corrects_id = i.id and c.kind = 'storno' and c.status = 'final'
      where (coalesce(i.service_to, i.service_from, i.issue_date) >= ${start} and coalesce(i.service_to, i.service_from, i.issue_date) < ${end})
        or (i.issue_date >= ${start} and i.issue_date < ${end})
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
