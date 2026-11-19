// Zahlung unter oder über dem offenen Betrag: Zuordnung samt Ausbuchung des Rests bzw. Kursdifferenz

import { randomUUID } from "node:crypto";
import { BankError } from "./bank-error.ts";
import { documentOpen, invoiceOpen } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks } from "../buchhaltung/index.ts";
import { schema, type Tx } from "../../db/index.ts";
import { bookPart, type Part } from "./allocation.ts";
import { type LockedTransaction, lockTransaction } from "./payment-booking.ts";
import { settledOn } from "./settled-amounts.ts";
import { bookWriteOff } from "./write-offs.ts";
import { mitEinemSteuersatz } from "./offene-posten.ts";

export const restSchema = z.object({
  transactionId: z.uuid(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("invoice"), invoiceId: z.uuid() }),
    z.object({ kind: z.literal("document"), documentId: z.uuid() }),
  ]),
  rest: z.enum(["skonto", "forderungsausfall", "skontoErhalten", "kursdifferenz"]),
  /** Nur mit Skonto auf eine Rechnung: offene Korrekturen, die der Kunde vor dem Skonto abgezogen hat (#1398) */
  korrekturen: z.array(z.uuid()).min(1).max(19).optional(),
});

/**
 * Zahlung unter dem offenen Betrag: den offenen Teil des Umsatzes zuordnen und den Rest der Rechnung bzw. des
 * Belegs mit Datum des Umsatzes ausbuchen (Skonto gewährt, Forderungsausfall, Skonto erhalten). Wird die Zuordnung
 * aufgehoben, wird die Ausbuchung mit aufgehoben.
 */
export async function allocateWithRest(actor: string, input: z.infer<typeof restSchema>): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, input.transactionId);
    if (bank.open === 0) throw new BankError("Der Umsatz ist schon ganz zugeordnet.");
    if (input.rest === "kursdifferenz") {
      await allocateWithExchangeDifference(tx, company, bank, input.target);
      return;
    }
    if (input.korrekturen) {
      if (input.target.kind !== "invoice" || input.rest !== "skonto") throw new BankError("Korrekturen gehen nur mit Skonto auf eine Rechnung.");
      await allocateWithCorrectionsAndSkonto(tx, company, bank, input.target.invoiceId, input.korrekturen);
      return;
    }
    const isInvoice = input.target.kind === "invoice";
    if (isInvoice !== (input.rest !== "skontoErhalten")) throw new BankError("Skonto erhalten gilt für Belege, Skonto und Forderungsausfall für Rechnungen.");
    const part: Part =
      input.target.kind === "invoice"
        ? { kind: "invoice", invoiceId: input.target.invoiceId, amount: bank.open }
        : { kind: "document", documentId: input.target.documentId, amount: bank.open };
    await bookPart(tx, company, bank, part, null);
    const base = { date: bank.bookingDate, transactionId: bank.id };
    await bookWriteOff(
      tx,
      company,
      input.target.kind === "invoice"
        ? { ...base, kind: input.rest as "skonto" | "forderungsausfall", invoiceId: input.target.invoiceId }
        : { ...base, kind: "skontoErhalten", documentId: input.target.documentId },
    );
  });
}

/**
 * Zahlung „Rechnung minus Korrektur minus Skonto“ (#1398): als Aufteilung jede Korrektur über ihren offenen Betrag und
 * die Rechnung über den Rest des Umsatzes, danach der Rest der Rechnung als gewährtes Skonto. Aufgehoben wird alles
 * zusammen (die Aufteilung samt Ausbuchung).
 */
async function allocateWithCorrectionsAndSkonto(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  invoiceId: string,
  korrekturen: readonly string[],
) {
  if (bank.amount <= 0) throw new BankError("Korrekturen und Skonto gibt es nur bei einem Zahlungseingang.");
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (invoice?.kind !== "rechnung" || invoice.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
  // Wie im Abgleich (skontoNachKorrektur): Skonto nur auf die noch ganz offene Rechnung
  if ((await settledOn(tx, "invoice_id", invoice.id)) !== 0)
    throw new BankError(`Rechnung ${invoice.number} ist schon teilweise bezahlt; Skonto gibt es nur auf den ganzen Betrag.`);
  // Alle offenen Korrekturen der Rechnung, nicht eine Auswahl: Eine übergangene bliebe offen, und ihre spätere Erstattung
  // minderte das Entgelt neben dem Skonto ein zweites Mal
  const rows = await tx
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "korrektur"), eq(schema.invoices.status, "final")));
  const parts: Part[] = [];
  for (const row of rows) {
    const open = invoiceOpen({ ...row, paid: await settledOn(tx, "invoice_id", row.id), cancelled: false });
    if (open < 0) parts.push({ kind: "invoice", invoiceId: row.id, amount: open });
  }
  const gewaehlt = new Set(korrekturen);
  if (parts.length !== gewaehlt.size || parts.some((p) => p.kind === "invoice" && !gewaehlt.has(p.invoiceId))) {
    throw new BankError("Die gewählten Korrekturen passen nicht zu den offenen Korrekturen der Rechnung. Bitte die Ansicht neu laden.");
  }
  const einSatz = await mitEinemSteuersatz(new Map([[invoice.id, [...gewaehlt]]]), tx);
  if (!einSatz.has(invoice.id)) {
    throw new BankError(
      "Skonto nach einer Korrektur geht nur, wenn Rechnung und Korrekturen denselben Steuersatz haben. Teile den Umsatz auf und buche den Rest einzeln.",
    );
  }
  const invoiceAmount = bank.open - parts.reduce((sum, p) => sum + p.amount, 0);
  const splitId = randomUUID();
  await bookPart(tx, company, bank, { kind: "invoice", invoiceId, amount: invoiceAmount }, splitId);
  for (const part of parts) await bookPart(tx, company, bank, part, splitId);
  await bookWriteOff(tx, company, { kind: "skonto", invoiceId, date: bank.bookingDate, transactionId: bank.id });
}

/**
 * Zahlung auf eine Rechnung bzw. einen Beleg in Fremdwährung, deren Euro-Betrag vom umgerechneten offenen Betrag abweicht.
 * Weniger als offen: Zahlung zuordnen, Rest als Kursdifferenz ausbuchen. Mehr als offen: als Aufteilung den offenen
 * Betrag auf die Rechnung bzw. den Beleg und den Überschuss als Kursdifferenz. Die Umsatzsteuer bleibt unverändert.
 */
async function allocateWithExchangeDifference(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  bank: LockedTransaction,
  target: z.infer<typeof restSchema>["target"],
) {
  let open: number;
  if (target.kind === "invoice") {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, target.invoiceId));
    if (invoice?.status !== "final") throw new BankError("Rechnung nicht zuordenbar.");
    if (invoice.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Rechnungen in Fremdwährung.");
    open = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
  } else {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, target.documentId));
    if (doc?.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
    if (doc.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Belegen in Fremdwährung.");
    open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
  }
  if (open === 0 || Math.sign(open) !== Math.sign(bank.open)) throw new BankError("Die Zahlung passt nicht zum offenen Betrag.");
  const toTarget = (amount: number): Part =>
    target.kind === "invoice" ? { kind: "invoice", invoiceId: target.invoiceId, amount } : { kind: "document", documentId: target.documentId, amount };
  if (Math.abs(bank.open) <= Math.abs(open)) {
    await bookPart(tx, company, bank, toTarget(bank.open), null);
    if (bank.open !== open) {
      await bookWriteOff(tx, company, {
        kind: "kursdifferenz",
        date: bank.bookingDate,
        transactionId: bank.id,
        ...(target.kind === "invoice" ? { invoiceId: target.invoiceId } : { documentId: target.documentId }),
      });
    }
  } else {
    // Wird die Aufteilung aufgehoben, dann ganz (reverseAllocation)
    const splitId = randomUUID();
    await bookPart(tx, company, bank, toTarget(open), splitId);
    await bookPart(tx, company, bank, { kind: "kursdifferenz", amount: bank.open - open }, splitId);
  }
}
