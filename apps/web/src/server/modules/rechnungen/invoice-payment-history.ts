import type { Cents } from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoicePaymentGroup } from "./advance-payment-group.ts";

export interface InvoicePayment {
  id: string;
  date: string;
  amount: Cents;
  /** bank: Zuordnung eines Bankumsatzes; bar: Bareinnahme im Kassenbuch */
  via: "bank" | "bar";
  text: string;
  /** Nur bar: Nummer der Zeile im Kassenbuch */
  cashNumber: number | null;
  reversed: boolean;
}

/** Zahlungen auf eine Rechnung, über die Bank und bar, ohne Gegenzeilen, mit Merker „storniert“ bzw. „aufgehoben“ */
export async function invoicePaymentList(invoiceId: string, q: Db | Tx = db): Promise<InvoicePayment[]> {
  const invoiceIds = await invoicePaymentGroup(invoiceId, q);
  const allocations = await q
    .select({
      id: schema.allocations.id,
      date: schema.bankTransactions.bookingDate,
      amount: schema.allocations.amount,
      text: schema.bankTransactions.counterpartyName,
      reversesId: schema.allocations.reversesId,
    })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .where(inArray(schema.allocations.invoiceId, invoiceIds))
    .orderBy(asc(schema.allocations.createdAt));
  const cash = await q.select().from(schema.cashEntries).where(inArray(schema.cashEntries.invoiceId, invoiceIds)).orderBy(asc(schema.cashEntries.number));
  const reversed = new Set([...allocations, ...cash].flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  const payments: InvoicePayment[] = [
    ...allocations
      .filter((a) => !a.reversesId)
      .map((a) => ({ id: a.id, date: a.date, amount: a.amount, via: "bank" as const, text: a.text, cashNumber: null, reversed: reversed.has(a.id) })),
    ...cash
      .filter((c) => !c.reversesId)
      .map((c) => ({ id: c.id, date: c.date, amount: c.amount, via: "bar" as const, text: c.text, cashNumber: c.number, reversed: reversed.has(c.id) })),
  ];
  return payments.sort((a, b) => a.date.localeCompare(b.date));
}
