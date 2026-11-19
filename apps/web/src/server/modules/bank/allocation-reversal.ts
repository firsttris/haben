// Aufhebung einer Zuordnung per Gegenzeile und Gegenbuchung
import { insertAllocation } from "./settlement-store.ts";
import { BankError } from "./bank-error.ts";
import type { Kontenrahmen, PostingLine } from "@haben/core";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { gesendeteMonate } from "./aufhebung-vorbelegung.ts";
import { openBooks, post, reverseLinesIn } from "../buchhaltung/index.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { lockInvoice } from "../rechnungen/index.ts";
import { freigabeNachziehen } from "../umsatzsteuer/index.ts";
import { today } from "../../today.ts";
import { darlehenAufhebenPruefen } from "./darlehen.ts";
import { negatedShares, settledOn } from "./settled-amounts.ts";
import { reverseWriteOffRow } from "./write-offs.ts";

/**
 * Hebt eine Zuordnung per Gegenzeile und Gegenbuchung auf; Teile einer Aufteilung nur alle zusammen.
 *
 * Gebucht wird am Tag der Aufhebung (#782), nicht am Buchungsdatum des Umsatzes: Eine Aufhebung ist ein Vorgang von
 * heute und berichtigt die Umsatzsteuer nach § 17 Abs. 1 UStG in dem Zeitraum, in dem sie erklärt wird. Ohne eigenes
 * Datum gilt heute. Ein schon gemeldeter Zeitraum ist bewusst kein Hindernis: Gerade dann wirkt die Aufhebung am
 * heutigen Tag und lässt die abgegebene Voranmeldung unberührt — eine Sperre nähme den einzigen Weg, einen Fehler zu
 * berichtigen. Den Belegstorno bedient reverseAllocationIn mit dem Datum aus cancellationDate.
 */
export async function reverseAllocation(actor: string, allocationId: string, date = today()): Promise<void> {
  // Liegt die Aufhebung in der Zukunft, weist der Weg über die Oberfläche sie ab (server/functions/bank.ts): Ein
  // vorgehaltener Auszug kann selbst in der Zukunft liegen, dort wäre ein Datum in seinem Zeitraum richtig.
  const heute = today();
  await withActor(actor, async (tx) => {
    // Die Zuordnung steht buchhalterisch am Buchungsdatum ihres Umsatzes; früher kann die Aufhebung nicht wirken.
    // Liegt die Zahlung selbst in der Zukunft (vorgehaltener Auszug), ist heute schon der früheste Tag.
    const [row] = await tx
      .select({ bookingDate: schema.bankTransactions.bookingDate })
      .from(schema.allocations)
      .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
      .where(eq(schema.allocations.id, allocationId));
    // Nur der Weg über die Oberfläche datiert vor; der Belegstorno bringt sein Datum selbst mit (cancellationDate)
    if (row && row.bookingDate <= heute && date < row.bookingDate) {
      throw new BankError(`Das Datum liegt vor dem Buchungsdatum der Zahlung (${row.bookingDate}). Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird.`);
    }
    await reverseAllocationIn(tx, allocationId, date);
  });
}

/** Wie reverseAllocation, innerhalb der withActor-Transaktion des Aufrufers (z. B. gemeinsamer Belegstorno). */
export async function reverseAllocationIn(tx: Tx, allocationId: string, date: string): Promise<void> {
  const [allocation] = await tx.select().from(schema.allocations).where(eq(schema.allocations.id, allocationId)).for("update");
  if (!allocation || allocation.reversesId) throw new BankError("Zuordnung nicht gefunden.");
  const [already] = await tx.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.reversesId, allocationId));
  if (already) throw new BankError("Die Zuordnung ist bereits aufgehoben.");
  // Die Gegenzeile kann nicht vor der Zahlung wirken: Der Belegstorno bringt sein Datum selbst mit (cancellationDate) und
  // liegt damit vor dem Buchungsdatum der Zahlung, wenn der Beleg vor der Zahlung datiert ist. Dann gilt das Buchungsdatum
  // der Zahlung, nicht der frühere Tag. Ein vorgehaltener Auszug (Zahlung selbst in der Zukunft) bleibt beim übergebenen
  // Tag: Dort wäre ein Datum im Zeitraum des Auszugs richtig.
  const heute = today();
  const [zahlung] = await tx
    .select({ bookingDate: schema.bankTransactions.bookingDate })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.id, allocation.transactionId));
  const tag = zahlung && date < zahlung.bookingDate && zahlung.bookingDate <= heute ? zahlung.bookingDate : date;
  // Liegt die Zahlung in einem abgeschlossenen Jahr, bleibt die Aufhebung gesperrt (Entscheidung des Maintainers zu #782).
  // Eine anschließende Neu-Zuordnung bucht am Buchungsdatum der Zahlung (bookPart) und fiele damit ins gesperrte Jahr:
  // der Vorgang bliebe halb offen und das Bankkonto wiche ab. Die Sperre greift vor dem ersten Schreibvorgang, für den
  // Bankweg und den gemeinsamen Belegstorno gleichermaßen; korrigiert wird stattdessen im offenen Jahr.
  if (zahlung) {
    const zahlungsJahr = Number(zahlung.bookingDate.slice(0, 4));
    const [geschlossen] = await tx.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, zahlungsJahr));
    if (geschlossen) {
      throw new BankError(
        `Die Zahlung vom ${zahlung.bookingDate} liegt im abgeschlossenen Jahr ${zahlungsJahr}. Eine Aufhebung ist dort nicht mehr möglich, weil sich die Zuordnung danach nicht neu buchen ließe. Korrigiere den Vorgang stattdessen mit einer Buchung im offenen Jahr.`,
      );
    }
  }
  // Einzelne Teile einer Aufteilung ergäben allein nicht mehr den Umsatz (die Gebühr bliebe ohne den Erlös stehen)
  const parts = allocation.splitId
    ? await tx
        .select()
        .from(schema.allocations)
        .where(and(eq(schema.allocations.splitId, allocation.splitId), isNull(schema.allocations.reversesId)))
        .orderBy(asc(schema.allocations.createdAt))
        .for("update")
    : [allocation];
  await darlehenAufhebenPruefen(tx, parts);
  for (const part of parts) await reverseOne(tx, part, tag);
  // Mit der Zahlung ausgebuchter Rest (Skonto): ohne die Zahlung wäre er falsch, also mit aufheben
  const targets = parts.flatMap((p) => [p.invoiceId, p.documentId]).filter((id): id is string => id !== null);
  if (targets.length > 0) {
    const linked = await tx
      .select()
      .from(schema.writeOffs)
      .where(
        and(
          eq(schema.writeOffs.transactionId, allocation.transactionId),
          isNull(schema.writeOffs.reversesId),
          or(inArray(schema.writeOffs.invoiceId, targets), inArray(schema.writeOffs.documentId, targets)),
        ),
      )
      .for("update");
    // Die mit der Zahlung ausgebuchte Restbuchung wirkt wie die Aufhebung selbst: an ihrem geklammerten Tag
    for (const writeOff of linked) await reverseWriteOffRow(tx, writeOff, tag);
  }
  await assertNoReturnWithoutPayment(tx, parts);
}

/**
 * Eine Rücklastschrift (#445) setzt die Zahlung voraus, die sie zurückholt: Ohne sie stünde die Rechnung über ihren
 * Betrag hinaus offen und würde so neu eingezogen. Erst die Rücklastschrift aufheben, dann die Zahlung.
 */
async function assertNoReturnWithoutPayment(tx: Tx, parts: (typeof schema.allocations.$inferSelect)[]) {
  const ids = [...new Set(parts.filter((p) => p.kind === "invoice" && p.amount > 0 && p.invoiceId).map((p) => p.invoiceId!))];
  if (ids.length === 0) return;
  const invoices = await tx
    .select({ id: schema.invoices.id, number: schema.invoices.number, gross: schema.invoices.gross })
    .from(schema.invoices)
    .where(inArray(schema.invoices.id, ids));
  for (const invoice of invoices) {
    if (invoice.gross > 0 && (await settledOn(tx, "invoice_id", invoice.id)) < 0) {
      throw new BankError(`Zu Rechnung ${invoice.number} ist eine Rücklastschrift zugeordnet; bitte zuerst sie aufheben.`);
    }
  }
}

async function reverseOne(tx: Tx, allocation: typeof schema.allocations.$inferSelect, date: string) {
  if (allocation.invoiceId) await lockInvoice(tx, allocation.invoiceId);
  const [already] = await tx.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.reversesId, allocation.id));
  if (already) return;
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(
      and(eq(schema.journalEntries.sourceType, "allocation"), eq(schema.journalEntries.sourceId, allocation.id), isNull(schema.journalEntries.reversesId)),
    );
  const lines = entry ? await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entry.id)) : [];
  const [reversal] = await insertAllocation(tx, {
    transactionId: allocation.transactionId,
    kind: allocation.kind,
    invoiceId: allocation.invoiceId,
    documentId: allocation.documentId,
    vatReturnId: allocation.vatReturnId,
    taxType: allocation.taxType,
    taxYear: allocation.taxYear,
    taxItem: allocation.taxItem,
    loanId: allocation.loanId,
    loanPart: allocation.loanPart,
    category: allocation.category,
    taxRate: allocation.taxRate,
    directDebitItemId: allocation.directDebitItemId,
    amount: -allocation.amount,
    splitId: allocation.splitId,
    reversesId: allocation.id,
    // Gegenzeile trägt ihren eigenen Tag (#782): Sie wirkt, wenn aufgehoben wird, nicht am Tag des Umsatzes
    date,
    taxShares: negatedShares(allocation.taxShares),
    taxSharesInvoiceId: allocation.taxSharesInvoiceId,
  });
  if (entry) {
    // Gegenbuchung im Kontenrahmen der Firmendaten; wechseln kann er nur, solange im Jahr nichts gebucht ist
    const books = await openBooks(tx);
    await post(tx, books, {
      date,
      description: `Storno: ${entry.description}`,
      sourceType: "allocation",
      sourceId: reversal!.id,
      lines: reverseLinesIn(
        entry.kontenrahmen as Kontenrahmen,
        books.kontenrahmen,
        lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"], basis: l.basis })),
      ),
      reversesId: entry.id,
    });
    // Aufgehobene Zahlung vor der Ausführung (#693): Der Vorgang ist wieder offen; der freigegebene Anteil fällt am Tag
    // der Aufhebung zurück, der Rest gehört wieder zum Ausführungsdatum
    if (allocation.documentId) await freigabeNachziehen(tx, allocation.documentId, books, date);
  }
}

/**
 * Monate, für die eine Voranmeldung als abgegeben vermerkt ist (#782). Danach richtet sich die Vorbelegung des
 * Tags der Aufhebung: Ein gemeldeter Zeitraum bleibt unverändert, die Gegenbuchung wirkt heute.
 */
export async function gemeldeteVoranmeldungen(): Promise<string[]> {
  const rows = await db
    .select({ jahr: schema.vatReturns.year, monat: schema.vatReturns.month })
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.status, "sent"));
  // Q1 liegt als month = 41 in vat_returns: erst in die Zahlungsmonate auflösen (#782)
  return gesendeteMonate(rows);
}
