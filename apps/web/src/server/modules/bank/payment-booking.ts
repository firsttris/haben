// Umsatz sperren und Zahlungen auf Rechnung oder Beleg prüfen und buchen

import { BankError } from "./bank-error.ts";
import {
  documentOpen,
  documentPaymentPosting,
  invoiceOpen,
  invoicePaymentPosting,
  advancePaymentDateProblem,
  type DirektKategorie,
  type PostingLine,
  type Steuerart,
  type SteuerPosten,
  type DarlehenTeil,
  type TaxShare,
} from "@haben/core";
import { and, eq } from "drizzle-orm";
import type { openBooks } from "../buchhaltung/index.ts";
import { schema, type Tx } from "../../db/index.ts";
import { bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { invoicePaymentPostingMode, invoiceTotalsById, lockInvoice, paperCancellationIds, paymentProcedure } from "../rechnungen/index.ts";
import { belegTotals } from "../umsatzsteuer/index.ts";
import { vorsteuerAusgleich } from "./vorsteuer-ausgleich.ts";
import { invoiceTaxShares, settledOn } from "./settled-amounts.ts";

/** Ein stornierter Beleg (#237) ist erledigt: keine Zahlung, kein Skonto, keine Kursdifferenz mehr */
export async function assertNotCancelled(tx: Tx, documentId: string): Promise<void> {
  const [cancelled] = await tx
    .select({ id: schema.documentCancellations.id })
    .from(schema.documentCancellations)
    .where(eq(schema.documentCancellations.documentId, documentId));
  if (cancelled) throw new BankError("Der Beleg ist storniert.");
}

/** Sperrt den Umsatz für die Dauer der Zuordnung: Zwei gleichzeitige Zuordnungen sähen sonst denselben offenen Teil */
export async function lockTransaction(tx: Tx, id: string) {
  const [bank] = await tx
    .select({
      id: schema.bankTransactions.id,
      amount: schema.bankTransactions.amount,
      bookingDate: schema.bankTransactions.bookingDate,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      ledgerIndex: schema.bankAccounts.ledgerIndex,
      purpose: schema.bankAccounts.purpose,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
    .where(eq(schema.bankTransactions.id, id))
    .for("update", { of: schema.bankTransactions });
  if (!bank) throw new BankError("Umsatz nicht gefunden.");
  return bank;
}

export type LockedTransaction = Awaited<ReturnType<typeof lockTransaction>>;

/**
 * Rücklastschrift (#445): Die Bank holt den eingezogenen Betrag zurück. Gebucht wie eine negative Zahlung auf die
 * Rechnung (Forderung wieder offen, bei Ist-Versteuerung die Umsatzsteuer zurück auf noch nicht fällig), höchstens bis
 * zum bezahlten Betrag; mit Bezug auf die Lastschrift, damit sie neu eingezogen werden kann.
 */
export async function returnBooking(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  part: { invoiceId: string; directDebitItemId: string; amount: number },
) {
  const invoice = await lockInvoice(tx, part.invoiceId);
  if (invoice?.status !== "final" || invoice.kind !== "rechnung") throw new BankError("Rechnung nicht zuordenbar.");

  const paid = await settledOn(tx, "invoice_id", invoice.id);
  if (part.amount >= 0 || -part.amount > paid) throw new BankError(`Rechnung ${invoice.number} ist nur über ${paid / 100} € bezahlt.`);
  const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
  const taxShares = await invoiceTaxShares(tx, invoice.id, totals, part.amount);
  return {
    lines: invoicePaymentPosting(totals, part.amount, company.kontenrahmen, await invoicePaymentPostingMode(invoice, tx), taxShares, invoice.taxTreatment),
    description: `Rücklastschrift ${invoice.number} · ${bank.counterpartyName}`,
    target: { invoiceId: invoice.id, taxShares, taxSharesInvoiceId: invoice.id, directDebitItemId: part.directDebitItemId },
  };
}

/** Ziel einer Zuordnung: Rechnung, Beleg oder der Bezug einer Buchung ohne Beleg */
export type Zuordnungsziel = {
  invoiceId?: string;
  documentId?: string;
  taxShares?: TaxShare[];
  taxSharesInvoiceId?: string;
  vatReturnId?: string;
  taxType?: Steuerart;
  taxYear?: number;
  taxItem?: SteuerPosten;
  loanId?: string;
  loanPart?: DarlehenTeil;
  category?: DirektKategorie;
  taxRate?: number;
  directDebitItemId?: string;
};

/** Zahlung auf eine Rechnung (auch Erstattung auf ein Storno): prüft den offenen Betrag und liefert die Zeilen */
export async function invoiceBooking(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  part: { invoiceId: string; amount: number },
): Promise<{ lines: PostingLine[]; description: string; target: Zuordnungsziel }> {
  const invoice = await lockInvoice(tx, part.invoiceId);
  if (invoice?.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
  const dateProblem = advancePaymentDateProblem(invoice, bank.bookingDate, part.amount, await paymentProcedure(invoice, tx));
  if (dateProblem) throw new BankError(dateProblem);

  const paidOn = (invoiceId: string) => settledOn(tx, "invoice_id", invoiceId);
  let open: number;
  if (invoice.kind === "storno") {
    if (!invoice.correctsId) throw new BankError("Rechnung nicht zuordenbar.");
    if ((await paperCancellationIds([invoice.id], tx)).has(invoice.id)) {
      throw new BankError("Die Schlussleistung besteht weiter; eine Erstattung lässt sich diesem Storno nicht zuordnen.");
    }
    open = invoiceOpen({ ...invoice, paid: await paidOn(invoice.id), paidOnOriginal: await paidOn(invoice.correctsId), cancelled: false });
  } else {
    const [storno] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
    if (storno) throw new BankError(`Rechnung ${invoice.number} ist storniert; eine Erstattung gehört zur Stornorechnung.`);
    open = invoiceOpen({ ...invoice, paid: await paidOn(invoice.id), cancelled: false });
  }
  if (Math.sign(open) !== Math.sign(part.amount) || Math.abs(part.amount) > Math.abs(open)) {
    throw new BankError(`Rechnung ${invoice.number} ist nur noch über ${open / 100} € offen.`);
  }
  const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
  const taxShares = await invoiceTaxShares(tx, invoice.id, totals, part.amount);
  const lines = invoicePaymentPosting(totals, part.amount, company.kontenrahmen, await invoicePaymentPostingMode(invoice, tx), taxShares, invoice.taxTreatment);
  // IBAN des Kunden für künftige Vorschläge merken
  if (invoice.contactId && bank.counterpartyIban) {
    await tx
      .update(schema.contacts)
      .set({ iban: bank.counterpartyIban })
      .where(and(eq(schema.contacts.id, invoice.contactId), eq(schema.contacts.iban, "")));
  }
  return {
    lines,
    description: `Zahlung ${invoice.number} · ${bank.counterpartyName}`,
    target: { invoiceId: invoice.id, taxShares, taxSharesInvoiceId: invoice.id },
  };
}

/** Zahlung auf einen Beleg: prüft den offenen Betrag und liefert die Zeilen samt Umbuchung vom Zwischenkonto */
export async function documentBooking(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  part: { documentId: string; amount: number; sammel?: true },
): Promise<{ lines: PostingLine[]; description: string; target: Zuordnungsziel }> {
  // Sperre wie bei der Rechnung: Zwei gleichzeitige Zuordnungen könnten den Beleg sonst überzahlen
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, part.documentId)).for("update");
  if (doc?.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
  if (doc.payment !== "bank") throw new BankError("Der Beleg ist als privat bezahlt gebucht.");
  await assertNotCancelled(tx, doc.id);
  const open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
  if (!part.sammel && (Math.sign(open) !== Math.sign(part.amount) || Math.abs(part.amount) > Math.abs(open))) {
    throw new BankError(`Der Beleg ist nur noch über ${Math.abs(open) / 100} € offen.`);
  }
  const lines = documentPaymentPosting(part.amount, company.kontenrahmen);
  // Vorsteuer vom Zwischenkonto auf die Vorsteuer: die Zahlung einer Rechnung, deren Leistung beim Buchen noch nicht
  // ausgeführt war (#693), und die Erstattung einer Gutschrift „erstattet bereits Bezahltes“ (#786). Hat die Buchung
  // nichts auf dem Zwischenkonto, kommt nichts dazu (Altbestand, Kleinunternehmer, 0 %)
  lines.push(...(await vorsteuerAusgleich(tx, doc, await belegTotals(tx, doc), part.amount, company.kontenrahmen, bank.bookingDate)));
  return { lines, description: `Zahlung Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`, target: { documentId: doc.id } };
}
