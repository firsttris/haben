import { insertCashEntry } from "./settlement-store.ts";
import { formatEuro, invoiceCashPaymentPosting, invoiceOpen, type Cents, type SkontoZahlfrist } from "@haben/core";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { invoicePaymentPostingMode, invoiceTotalsById, lockInvoice } from "../rechnungen/index.ts";
import { bookWriteOff, invoiceTaxShares, openItems, settledOn } from "./bank.ts";
import { CashError, lockCash, nextNumber, type CashEntry } from "./cash.ts";
import { bareinnahmeSteuerSchema, bookCashIncome } from "./cash-income.ts";

/*
 * Bareinnahme auf eine Ausgangsrechnung im Kassenbuch: gebucht wie die Zuordnung eines Bankumsatzes zur Rechnung, nur
 * Kasse statt Bank (invoiceCashPaymentPosting). Teilzahlungen gehen, eine Überzahlung nicht; ein Rest lässt sich wie im
 * Bankabgleich als gewährtes Skonto ausbuchen. Storno über reverseCashEntry (cash.ts).
 */

export const cashInvoiceInputSchema = z.object({
  invoiceId: z.uuid(),
  date: z.iso.date(),
  /** Cent, immer positiv: Geld kommt in die Kasse */
  amount: z.number().int().min(1, "Betrag fehlt").max(100_000_000),
  text: z.string().trim().max(300).default(""),
  /** Rest der Rechnung als gewährtes Skonto ausbuchen, mit Datum der Bareinnahme (wie „Rest als Skonto“ im Bankabgleich) */
  skonto: z.boolean().default(false),
  /**
   * Aufteilen (#455): was der Kunde über den Rechnungsbetrag hinaus gibt, etwa Trinkgeld, als weitere Bareinnahme mit
   * eigener Steuerbehandlung; nur wenn die Rechnung damit ganz bezahlt ist
   */
  extra: z
    .object({
      amount: z.number().int().min(1, "Betrag der weiteren Einnahme fehlt").max(100_000_000),
      steuer: bareinnahmeSteuerSchema,
      text: z.string().trim().max(250).default(""),
    })
    .optional(),
});

export type CashInvoiceInput = z.input<typeof cashInvoiceInputSchema>;

/** Bareinnahme auf eine Rechnung buchen; mit `skonto` den Rest als gewährtes Skonto ausbuchen */
export async function createCashInvoiceEntry(actor: string, input: CashInvoiceInput, today: string): Promise<CashEntry> {
  const parsed = cashInvoiceInputSchema.parse(input);
  if (parsed.date > today) throw new CashError("Das Datum liegt in der Zukunft.");
  return withActor(actor, async (tx) => {
    // Erst die Kasse, dann Rechnung und Buchungen sperren (lockCash)
    await lockCash(tx);
    const books = await openBooks(tx);
    const invoice = await lockInvoice(tx, parsed.invoiceId);
    if (invoice?.status !== "final") throw new CashError("Rechnung nicht gefunden.");

    if (invoice.kind === "storno") throw new CashError("Eine Stornorechnung lässt sich nicht bar kassieren.");
    if (invoice.currency !== "EUR") throw new CashError("Bar kassieren geht nur bei Rechnungen in Euro.");
    // Ein Datum vor dem Rechnungsdatum ist erlaubt (#455), wie im Bankabgleich: Der Kunde hat bar bezahlt, die Rechnung
    // (etwa eine Sammelrechnung) kam später. Bei Ist zählt die Steuer im Monat der Bareinnahme (§ 13 Abs. 1 Nr. 1 Buchst. b
    // UStG), bei Soll bleibt sie bei der Rechnung, die EÜR zählt den Zufluss am Tag der Bareinnahme (§ 11 Abs. 1 EStG).
    const [storno] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
    if (storno) throw new CashError(`Rechnung ${invoice.number} ist storniert.`);
    const open = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
    if (open <= 0) throw new CashError(`Rechnung ${invoice.number} ist nicht mehr offen.`);
    if (parsed.amount > open) {
      throw new CashError(`Rechnung ${invoice.number} ist nur noch über ${formatEuro(open)} offen; mehr lässt sich nicht bar kassieren.`);
    }
    if (parsed.skonto && parsed.amount === open) throw new CashError("Es bleibt kein Rest, der als Skonto auszubuchen wäre.");
    if (parsed.extra && parsed.amount !== open) {
      throw new CashError(`Eine weitere Einnahme geht nur, wenn Rechnung ${invoice.number} damit ganz bezahlt ist (offen ${formatEuro(open)}).`);
    }

    const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
    const taxShares = await invoiceTaxShares(tx, invoice.id, totals, parsed.amount);
    const id = crypto.randomUUID();
    const text = parsed.text || `Rechnung ${invoice.number} · ${invoice.buyer?.name ?? ""}`.replace(/ · $/, "");
    const journalEntryId = await post(tx, books, {
      date: parsed.date,
      description: text,
      sourceType: "kasse",
      sourceId: id,
      lines: invoiceCashPaymentPosting(
        totals,
        parsed.amount,
        books.kontenrahmen,
        await invoicePaymentPostingMode(invoice, tx),
        taxShares,
        invoice.taxTreatment,
      ),
    });
    const [row] = await insertCashEntry(tx, {
      id,
      number: await nextNumber(tx),
      date: parsed.date,
      amount: parsed.amount,
      kind: "rechnung",
      text,
      invoiceId: invoice.id,
      taxShares,
      taxSharesInvoiceId: invoice.id,
      journalEntryId,
    });
    if (parsed.skonto) await bookWriteOff(tx, books, { kind: "skonto", invoiceId: invoice.id, date: parsed.date, cashEntryId: id });
    // Der Teil über dem Rechnungsbetrag ist eine eigene Zeile mit der nächsten Nummer, gebucht wie eine Bareinnahme ohne
    // Rechnung; scheitert sie (etwa am Kleinunternehmer-Stand), bucht die Transaktion auch den Rechnungsteil nicht
    if (parsed.extra) {
      await bookCashIncome(tx, books, {
        date: parsed.date,
        amount: parsed.extra.amount,
        text: `${parsed.extra.text || "Weitere Einnahme"} zu Rechnung ${invoice.number}`,
        angabe: parsed.extra.steuer,
      });
    }
    return row!;
  });
}

export interface CashInvoiceCandidate {
  id: string;
  number: string;
  date: string;
  customer: string;
  open: Cents;
  /** Skonto je Stufe, nur solange die Rechnung noch ganz offen ist (wie im Bankabgleich) */
  skonto: SkontoZahlfrist[];
}

/** Offene Ausgangsrechnungen in Euro, die sich bar kassieren lassen: dieselben offenen Posten wie im Bankabgleich */
export async function cashInvoiceCandidates(): Promise<CashInvoiceCandidate[]> {
  const items = await openItems();
  return items
    .filter((i) => i.type === "invoice" && i.currency === "EUR" && i.open > 0)
    .map((i) => ({ id: i.id, number: i.number, date: i.date, customer: i.partyName, open: i.open, skonto: i.skonto ?? [] }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

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
export async function invoicePaymentList(invoiceId: string): Promise<InvoicePayment[]> {
  const allocations = await db
    .select({
      id: schema.allocations.id,
      date: schema.bankTransactions.bookingDate,
      amount: schema.allocations.amount,
      text: schema.bankTransactions.counterpartyName,
      reversesId: schema.allocations.reversesId,
    })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .where(eq(schema.allocations.invoiceId, invoiceId))
    .orderBy(asc(schema.allocations.createdAt));
  const cash = await db.select().from(schema.cashEntries).where(eq(schema.cashEntries.invoiceId, invoiceId)).orderBy(asc(schema.cashEntries.number));
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
