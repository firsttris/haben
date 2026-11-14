import { bareinnahmeAnteil, kategorieAnteil, outgoingTaxClassification, type InvoiceTotals } from "@haben/core";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { bankAccountIncludedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { invoiceTotalsById } from "../rechnungen/index.ts";
import { turnoverRange, unknownTurnover, type GesamtumsatzItem } from "./gesamtumsatz-quellen.ts";
import { takenOverClassifications } from "./gesamtumsatz-altbestand.ts";
import { paymentBases } from "./gesamtumsatz-zahlungsanteile.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Allocation = typeof schema.allocations.$inferSelect;
type Cash = typeof schema.cashEntries.$inferSelect;
type Payment = Pick<Allocation, "id" | "invoiceId" | "amount" | "taxShares" | "taxSharesInvoiceId">;
type PaymentData = Awaited<ReturnType<typeof invoiceData>> & { bases: ReturnType<typeof paymentBases> };

async function invoiceData(ids: string[], q: Db | Tx) {
  const invoices = new Map<string, Invoice>();
  let missing = [...new Set(ids)];
  while (missing.length) {
    const next: string[] = [];
    for (let i = 0; i < missing.length; i += 5000) {
      for (const row of await q
        .select()
        .from(schema.invoices)
        .where(inArray(schema.invoices.id, missing.slice(i, i + 5000)))) {
        invoices.set(row.id, row);
        if (row.correctsId && !invoices.has(row.correctsId)) next.push(row.correctsId);
      }
    }
    missing = [...new Set(next)].filter((id) => !invoices.has(id));
  }
  const totals = new Map<string, InvoiceTotals>();
  for (let i = 0; i < ids.length; i += 5000) for (const [id, value] of await invoiceTotalsById(ids.slice(i, i + 5000), q)) totals.set(id, value);
  const legacy = await takenOverClassifications(
    [...invoices.values()].flatMap((row) => (row.lexofficeVoucherId ? [row.lexofficeVoucherId] : [])),
    q,
  );
  return { invoices, totals, legacy };
}

function originalInvoice(invoice: Invoice, invoices: Map<string, Invoice>): Invoice | null {
  const seen = new Set<string>();
  let current = invoice;
  while (current.correctsId) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const original = invoices.get(current.correctsId);
    if (!original) return null;
    current = original;
  }
  return current;
}

function invoicePayment(source: "bank" | "cash", payment: Payment, date: string, data: PaymentData): GesamtumsatzItem {
  const invoice = payment.invoiceId ? data.invoices.get(payment.invoiceId) : undefined;
  const original = invoice ? originalInvoice(invoice, data.invoices) : null;
  return {
    source,
    sourceId: payment.id,
    occurredOn: date,
    gross: payment.amount,
    ...(data.bases.get(`${source}:${payment.id}`) ?? { net: null, basisSource: "unknown" }),
    classification: original
      ? original.lexofficeVoucherId && !original.taxDetails
        ? (data.legacy.get(original.lexofficeVoucherId) ?? null)
        : outgoingTaxClassification(original.taxTreatment, original.taxDetails)
      : null,
    label: invoice?.number ?? "Rechnungszahlung",
    invoiceId: payment.invoiceId ?? undefined,
  };
}

/** Eine aufgehobene Bankzuordnung ist keine Erstattung; der offene Bankteil wird danach erneut beurteilt. */
function cancelledAllocations(rows: Allocation[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cancelled = new Set<string>();
  for (const row of rows) {
    const original = row.reversesId ? byId.get(row.reversesId) : undefined;
    if (
      original &&
      original.transactionId === row.transactionId &&
      original.kind === row.kind &&
      original.invoiceId === row.invoiceId &&
      original.amount === -row.amount
    ) {
      cancelled.add(original.id);
      cancelled.add(row.id);
    }
  }
  return cancelled;
}

function allocationItem(row: Allocation, date: string, data: PaymentData, cancelled: Set<string>): GesamtumsatzItem {
  const item = unknownTurnover("bank", row.id, "Bankzuordnung", date, row.amount, "Die Ausgangsleistung oder ihre Umsatzart ist ungeklärt.");
  item.transactionId = row.transactionId;
  if (cancelled.has(row.id)) return { ...item, net: 0, basisSource: "stored", classification: { kind: "not_turnover" }, label: "Aufgehobene Bankzuordnung" };
  if (row.kind === "invoice") return { ...invoicePayment("bank", row, date, data), transactionId: row.transactionId };
  if (row.kind === "kategorie" && row.category === "erloese" && row.taxRate !== null) {
    return {
      ...item,
      net: kategorieAnteil({ kategorie: "erloese", steuersatz: row.taxRate }, row.amount).base,
      basisSource: "derived",
      classification: outgoingTaxClassification(row.taxRate === 0 ? "kleinunternehmer" : "regulaer", row.taxDetails),
      label: "Direkte Einnahme",
      uncertainty: undefined,
    };
  }
  if (row.kind === "zinsertrag")
    return {
      ...item,
      net: row.amount,
      basisSource: "stored",
      classification: outgoingTaxClassification("steuerfrei", row.taxDetails),
      uncertainty: "Bei betrieblichen Zinsen fehlen Vorschrift und Einordnung als Hilfsumsatz.",
    };
  return { ...item, classification: { kind: "not_turnover" } };
}

function cashItem(row: Cash, data: PaymentData): GesamtumsatzItem | null {
  if (row.kind === "import") return null; // Das Journal ist die Quelle; der Kassenbucheintrag ist nur dessen Spiegel.
  if (row.invoiceId) return invoicePayment("cash", row, row.date, data);
  const item = unknownTurnover("cash", row.id, row.text, row.date, row.amount, "Die Umsatzart der Kassenzeile ist ungeklärt.");
  if (row.kind === "einnahme" && row.taxTreatment && row.taxRate !== null)
    return {
      ...item,
      net: bareinnahmeAnteil({ behandlung: row.taxTreatment, steuersatz: row.taxRate }, row.amount).base,
      basisSource: "derived",
      classification: outgoingTaxClassification(row.taxTreatment, row.taxDetails),
      uncertainty: undefined,
    };
  return { ...item, classification: { kind: "not_turnover" } };
}

/** Tatsächliche Nebenbuchzahlungen, ohne Ausbuchungen, Rechnungsstellung oder Ist/Soll-Umschaltung (§ 19 Abs. 2 UStG). */
export async function nativeTurnoverItems(year: number, q: Db | Tx): Promise<GesamtumsatzItem[]> {
  const { start, end } = turnoverRange(year);
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const c = schema.cashEntries;
  const [bank, cash, open] = await Promise.all([
    q
      .select({ allocation: a, date: t.bookingDate, currency: t.currency })
      .from(a)
      .innerJoin(t, eq(t.id, a.transactionId))
      .where(and(lt(t.bookingDate, end), bankAccountIncludedSql("bank_transactions.bank_account_id"))),
    q.select().from(c).where(lt(c.date, end)),
    q
      .select({ id: t.id, date: t.bookingDate, amount: bankOpenAmountSql })
      .from(t)
      .where(and(gte(t.bookingDate, start), lt(t.bookingDate, end), bankAccountIncludedSql("bank_transactions.bank_account_id"), ne(bankOpenAmountSql, 0))),
  ]);
  const ids = [...new Set([...bank.map((row) => row.allocation.invoiceId), ...cash.map((row) => row.invoiceId)].filter((id): id is string => id !== null))];
  const invoices = await invoiceData(ids, q);
  const cancelled = cancelledAllocations(bank.map((row) => row.allocation));
  const bases = paymentBases(
    [
      ...bank
        .filter((row) => row.allocation.invoiceId && !cancelled.has(row.allocation.id))
        .map((row) => ({ ...row.allocation, date: row.date, source: "bank" as const })),
      ...cash.filter((row) => row.invoiceId).map((row) => ({ ...row, source: "cash" as const })),
    ],
    invoices.totals,
  );
  const data = { ...invoices, bases };
  const items = bank
    .filter((row) => row.date >= start)
    .map((row) => {
      const item = allocationItem(row.allocation, row.date, data, cancelled);
      return row.currency === "EUR"
        ? item
        : { ...item, net: null, basisSource: "unknown" as const, uncertainty: "Der Zahlungseingang ist nicht in Euro belegt." };
    });
  for (const row of cash) {
    if (row.date < start) continue;
    const item = cashItem(row, data);
    if (item) items.push(item);
  }
  for (const row of open)
    items.push({
      ...unknownTurnover(
        "bank",
        `open:${row.id}`,
        "Nicht zugeordneter Bankbetrag",
        row.date,
        Number(row.amount),
        "Der offene Bankbetrag kann eine Einnahme oder Erstattung enthalten; Nettoentgelt und Umsatzart sind ungeklärt.",
      ),
      transactionId: row.id,
    });
  return items;
}
