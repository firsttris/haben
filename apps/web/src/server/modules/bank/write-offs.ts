// Ausbuchungen: Skonto, Forderungsausfall, erhaltenes Skonto und Kursdifferenz samt Aufhebung
import { insertWriteOff } from "./settlement-store.ts";
import { BankError } from "./bank-error.ts";
import {
  type Kontenrahmen,
  documentOpen,
  exchangeDifferencePosting,
  invoiceWriteOffPosting,
  WRITE_OFF_KINDS,
  invoiceOpen,
  type PostingLine,
  type TaxShare,
  inCents,
} from "@haben/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks, post, reverseLinesIn } from "../buchhaltung/index.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { invoicePaymentPostingMode, invoiceTotalsById, invoicePostingMode, lockInvoice, unbilledAdvanceRequest } from "../rechnungen/index.ts";
import { belegTotals, freigabeNachziehen } from "../umsatzsteuer/index.ts";
import { belegSkontoPosting } from "./skonto-vorsteuer.ts";
import { vorsteuerAusgleich } from "./vorsteuer-ausgleich.ts";
import { assertNotCancelled } from "./payment-booking.ts";
import { invoiceTaxShares, negatedShares, settledOn } from "./settled-amounts.ts";

export const writeOffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["skonto", "forderungsausfall"]), invoiceId: z.uuid(), date: z.iso.date(), amount: inCents(z.number().int()).optional() }),
  z.object({ kind: z.literal("skontoErhalten"), documentId: z.uuid(), date: z.iso.date(), amount: inCents(z.number().int()).optional() }),
]);

export type WriteOffInput = z.infer<typeof writeOffSchema>;

/** Kursdifferenz: nur zusammen mit einer Zahlung (allocateWithRest), auf eine Rechnung oder einen Beleg in Fremdwährung */
type ExchangeDifferenceInput = { kind: "kursdifferenz"; date: string; transactionId: string } & ({ invoiceId: string } | { documentId: string });

/** Was eine Ausbuchung bucht: Betrag, Zeilen, Text und das Ziel in write_offs */
interface Ausbuchung {
  amount: number;
  lines: PostingLine[];
  description: string;
  target: { invoiceId: string | null; documentId: string | null; taxShares?: TaxShare[]; taxSharesInvoiceId?: string };
}

/** Kursdifferenz auf eine Rechnung in Fremdwährung: der ganze offene Rest */
async function kursdifferenzRechnung(tx: Tx, company: Awaited<ReturnType<typeof openBooks>>, input: { invoiceId: string }): Promise<Ausbuchung> {
  const invoice = await lockInvoice(tx, input.invoiceId);
  if (invoice?.status !== "final") throw new BankError("Rechnung nicht gefunden.");
  if (invoice.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Rechnungen in Fremdwährung.");
  const amount = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
  const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
  const taxShares = await invoiceTaxShares(tx, invoice.id, totals, amount);
  const lines = exchangeDifferencePosting(
    {
      kind: "invoice",
      totals,
      versteuerung: await invoicePaymentPostingMode(invoice, tx),
      shares: taxShares,
      treatment: invoice.taxTreatment,
    },
    amount,
    company.kontenrahmen,
  );
  return {
    amount,
    lines,
    description: `Kursdifferenz · Rechnung ${invoice.number}`,
    target: { invoiceId: invoice.id, documentId: null, taxShares, taxSharesInvoiceId: invoice.id },
  };
}

/** Kursdifferenz auf einen Beleg in Fremdwährung: der ganze offene Rest */
async function kursdifferenzBeleg(tx: Tx, company: Awaited<ReturnType<typeof openBooks>>, input: { documentId: string; date: string }): Promise<Ausbuchung> {
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId)).for("update");
  if (doc?.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
  if (doc.currency === "EUR") throw new BankError("Eine Kursdifferenz gibt es nur bei Belegen in Fremdwährung.");
  await assertNotCancelled(tx, doc.id);
  const amount = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
  const lines = exchangeDifferencePosting({ kind: "document" }, amount, company.kontenrahmen);
  // Die Steuer bleibt beim Kurs des Belegs; der ausgeglichene Anteil geht trotzdem vom Zwischenkonto, wenn dort
  // etwas steht: geparkte Vorsteuer (#693) oder eine Gutschrift „erstattet bereits Bezahltes“ (#786). Vor der
  // Ausführung bleibt er dort und wird mit ihr frei (§ 16 Abs. 6 UStG)
  lines.push(...(await vorsteuerAusgleich(tx, doc, await belegTotals(tx, doc), amount, company.kontenrahmen, input.date, true)));
  return {
    amount,
    lines,
    description: `Kursdifferenz · Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`,
    target: { invoiceId: null, documentId: doc.id },
  };
}

/** Erhaltenes Skonto auf einen Beleg samt Minderung der Vorsteuer (§ 17 Abs. 1 Satz 2 UStG) */
async function skontoErhalten(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  input: { documentId: string; date: string; amount?: number },
): Promise<Ausbuchung> {
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId)).for("update");
  if (doc?.status !== "gebucht") throw new BankError("Der Beleg muss erst gebucht sein.");
  if (doc.payment !== "bank") throw new BankError("Der Beleg ist privat oder bar bezahlt; dort gibt es nichts auszubuchen.");
  await assertNotCancelled(tx, doc.id);
  if (doc.reverseCharge) throw new BankError("Skonto auf Belege mit § 13b oder innergemeinschaftlichem Erwerb wird nicht unterstützt.");
  if (doc.privateShare > 0) throw new BankError("Skonto auf Belege mit Privatanteil wird nicht unterstützt.");
  if (doc.category === "anlage") throw new BankError("Skonto auf Anlagegüter mindert die Anschaffungskosten und wird nicht unterstützt.");
  const open = documentOpen(doc.gross, await settledOn(tx, "document_id", doc.id));
  const amount = input.amount ?? open;
  if (open === 0 || Math.sign(open) !== Math.sign(amount) || Math.abs(amount) > Math.abs(open)) {
    throw new BankError(`Der Beleg ist nur noch über ${Math.abs(open) / 100} € offen.`);
  }
  // Gutschrift „erstattet bereits Bezahltes“ (#786) und Skonto vor der Ausführung (#693): Die Steuerzeile schreibt den
  // Anteil vom Zwischenkonto ab; aus dem Betrag dieses Skontos allein gerechnet bliebe ein Cent darauf stehen
  const lines = await belegSkontoPosting(tx, doc, amount, company.kontenrahmen, input.date);
  return {
    amount,
    lines,
    description: `Skonto erhalten · Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`,
    target: { invoiceId: null, documentId: doc.id },
  };
}

/** Skonto oder Forderungsausfall auf eine Rechnung samt Korrektur der Umsatzsteuer */
async function rechnungAusbuchen(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  input: { kind: "skonto" | "forderungsausfall"; invoiceId: string; date: string; amount?: number },
): Promise<Ausbuchung> {
  const invoice = await lockInvoice(tx, input.invoiceId);
  if (invoice?.status !== "final") throw new BankError("Rechnung nicht gefunden.");

  if (invoice.kind === "storno") throw new BankError("Eine Stornorechnung lässt sich nicht ausbuchen.");
  const [storno] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, invoice.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
  if (storno) throw new BankError(`Rechnung ${invoice.number} ist storniert.`);
  if (input.kind === "forderungsausfall" && (await unbilledAdvanceRequest(invoice, input.date, tx))) {
    throw new BankError(
      "Diese Anzahlungsanforderung ist noch nicht bilanziert. Bitte storniere die Anforderung. Ein Preisnachlass gehört in die Schlussrechnung.",
    );
  }
  const open = invoiceOpen({ ...invoice, paid: await settledOn(tx, "invoice_id", invoice.id), cancelled: false });
  const amount = input.amount ?? open;
  if (open === 0 || Math.sign(open) !== Math.sign(amount) || Math.abs(amount) > Math.abs(open)) {
    throw new BankError(`Rechnung ${invoice.number} ist nur noch über ${open / 100} € offen.`);
  }
  const totals = (await invoiceTotalsById([invoice.id], tx)).get(invoice.id)!;
  const taxShares = await invoiceTaxShares(tx, invoice.id, totals, amount);
  const lines = invoiceWriteOffPosting(
    input.kind,
    totals,
    amount,
    company.kontenrahmen,
    await invoicePostingMode(invoice, tx),
    invoice.taxTreatment,
    taxShares,
  );
  return {
    amount,
    lines,
    description: `${WRITE_OFF_KINDS[input.kind]} · Rechnung ${invoice.number}`,
    target: { invoiceId: invoice.id, documentId: null, taxShares, taxSharesInvoiceId: invoice.id },
  };
}

/**
 * Bucht den Rest einer Rechnung bzw. eines Belegs aus (ohne amount: den ganzen offenen Betrag). Prüft den offenen
 * Betrag wie eine Zuordnung, bucht Erlösschmälerung bzw. Forderungsverlust oder erhaltenes Skonto samt Korrektur der
 * Umsatzsteuer bzw. Vorsteuer (§ 17 UStG) und gibt den ausgebuchten Betrag zurück.
 */
export async function bookWriteOff(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  input: (WriteOffInput & { transactionId?: string; cashEntryId?: string }) | ExchangeDifferenceInput,
): Promise<number> {
  let ausbuchung: Ausbuchung;
  if (input.kind === "kursdifferenz") {
    ausbuchung = "invoiceId" in input ? await kursdifferenzRechnung(tx, company, input) : await kursdifferenzBeleg(tx, company, input);
    if (ausbuchung.amount === 0) return 0;
  } else if (input.kind === "skontoErhalten") ausbuchung = await skontoErhalten(tx, company, input);
  else ausbuchung = await rechnungAusbuchen(tx, company, input);
  const { amount, lines, description, target } = ausbuchung;
  const [row] = await insertWriteOff(tx, {
    kind: input.kind,
    ...target,
    date: input.date,
    amount,
    transactionId: input.transactionId ?? null,
    cashEntryId: "cashEntryId" in input ? (input.cashEntryId ?? null) : null,
  });
  await post(tx, company, { date: input.date, description, sourceType: "ausbuchung", sourceId: row!.id, lines });
  // Skonto oder Kursdifferenz vor der Ausführung (#693): Die Freigabe zum Ausführungsdatum deckt nur noch, was wartet
  if (target.documentId) await freigabeNachziehen(tx, target.documentId, company, input.date);
  return amount;
}

/** Rest einer Rechnung oder eines Belegs ausbuchen, z. B. einen Forderungsausfall ohne Zahlung */
export async function writeOff(actor: string, input: WriteOffInput): Promise<void> {
  await withActor(actor, async (tx) => {
    await bookWriteOff(tx, await openBooks(tx), input);
  });
}

/** Ausbuchungen einer Rechnung bzw. eines Belegs, ohne Gegenzeilen, mit Merker „aufgehoben“ */
export async function listWriteOffs(target: { invoiceId: string } | { documentId: string }) {
  const rows = await db
    .select()
    .from(schema.writeOffs)
    .where("invoiceId" in target ? eq(schema.writeOffs.invoiceId, target.invoiceId) : eq(schema.writeOffs.documentId, target.documentId))
    .orderBy(asc(schema.writeOffs.createdAt));
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  return rows.filter((r) => !r.reversesId).map((r) => ({ ...r, reversed: reversed.has(r.id) }));
}

/**
 * Hebt eine Ausbuchung auf; gehört sie zu einer Zahlung, nur zusammen mit deren Zuordnung (im Bankabgleich). Gebucht
 * wird am Tag der Aufhebung (`date`): Zahlt der Kunde einen ausgebuchten Betrag doch, ist die Umsatzsteuer nach § 17
 * Abs. 2 Nr. 1 Satz 2 UStG im Monat des Zahlungseingangs erneut zu berichtigen, nicht rückwirkend im Monat der Ausbuchung.
 */
export async function reverseWriteOff(actor: string, id: string, date: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [row] = await tx.select().from(schema.writeOffs).where(eq(schema.writeOffs.id, id)).for("update");
    if (!row || row.reversesId) throw new BankError("Ausbuchung nicht gefunden.");
    if (row.transactionId) throw new BankError("Die Ausbuchung gehört zu einer Zahlung; hebe dort im Bankabgleich die Zuordnung auf.");
    if (row.cashEntryId) throw new BankError("Die Ausbuchung gehört zu einer Bareinnahme; storniere dort im Kassenbuch die Zeile.");
    const [already] = await tx.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.reversesId, id));
    if (already) throw new BankError("Die Ausbuchung ist bereits aufgehoben.");
    await reverseWriteOffRow(tx, row, date < row.date ? row.date : date);
  });
}

/**
 * Gegenzeile einer Ausbuchung; ohne Datum an ihrem eigenen. Mit einer Zuordnung zusammen trägt sie deren Aufhebungsdatum
 * (reverseAllocationIn), mit einer Bareinnahme das der Kasse (cash.ts).
 */
export async function reverseWriteOffRow(tx: Tx, row: typeof schema.writeOffs.$inferSelect, date = row.date) {
  if (row.invoiceId) await lockInvoice(tx, row.invoiceId);
  const [already] = await tx.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.reversesId, row.id));
  if (already) return;
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "ausbuchung"), eq(schema.journalEntries.sourceId, row.id), isNull(schema.journalEntries.reversesId)));
  const lines = entry ? await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entry.id)) : [];
  const [reversal] = await insertWriteOff(tx, {
    kind: row.kind,
    invoiceId: row.invoiceId,
    documentId: row.documentId,
    date,
    amount: -row.amount,
    transactionId: row.transactionId,
    cashEntryId: row.cashEntryId,
    reversesId: row.id,
    taxShares: negatedShares(row.taxShares),
    taxSharesInvoiceId: row.taxSharesInvoiceId,
  });
  if (entry) {
    const books = await openBooks(tx);
    await post(tx, books, {
      date,
      description: `Storno: ${entry.description}`,
      sourceType: "ausbuchung",
      sourceId: reversal!.id,
      lines: reverseLinesIn(
        entry.kontenrahmen as Kontenrahmen,
        books.kontenrahmen,
        lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"], basis: l.basis })),
      ),
      reversesId: entry.id,
    });
    // Aufgehobene Ausbuchung auf einen Beleg (#693): wie bei der Zuordnung die Freigabe zum Leistungsdatum nachziehen
    if (row.documentId) await freigabeNachziehen(tx, row.documentId, books, date);
  }
}
