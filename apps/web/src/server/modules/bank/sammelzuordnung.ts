import { documentOpen } from "@haben/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { bankDuplicateProposalEligibleSql, bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { schema, type Tx } from "../../db/index.ts";
import { openBooks } from "../buchhaltung/index.ts";
import { bookPart } from "./allocation.ts";
import { BankError } from "./bank-error.ts";
import { lockTransaction } from "./payment-booking.ts";
import { settledOn } from "./settled-amounts.ts";

export const feesSchema = z.object({ transactionId: z.uuid(), documentId: z.uuid() });

/** Erst die Umsätze in derselben UUID-Reihenfolge wie die Dublettenprüfung sperren, dann den aktuellen Stand lesen. */
async function lockEligibleFees(tx: Tx, chosenId: string, rowIds: string[]) {
  const bank = schema.bankTransactions;
  const ids = inArray(bank.id, [...new Set([chosenId, ...rowIds])]);
  await tx.select({ id: bank.id }).from(bank).where(ids).orderBy(asc(bank.id)).for("update");
  const eligible = await tx.select({ id: bank.id }).from(bank).where(and(ids, bankDuplicateProposalEligibleSql));
  const eligibleIds = new Set(eligible.map((row) => row.id));
  if (!eligibleIds.has(chosenId)) throw new BankError("Kläre zuerst den Dublettenverdacht zum gewählten Umsatz.");
  return eligibleIds;
}

/**
 * Gebühren eines Zahlungsdienstleisters gegen seine Sammelrechnung: ordnet alle noch offenen Gebühren (Umsätze „Gebühr …“)
 * desselben Kontos aus dem Monat des gewählten Umsatzes dem Beleg zu, wie Teilzahlungen, bis der Beleg erledigt ist.
 * Vorsteuer bzw. § 13b laufen dann einmal über den Beleg. Gibt die Zahl der zugeordneten Zeilen zurück.
 *
 * Gutschriften (#680, positive Zeilen „Gebühr …“, etwa die Gutschrift einer Gebühr bei Erstattung) rechnet der Dienstleister
 * in die Rechnung ein. Sie gehen nur mit, wenn alle offenen Gebühren und Gutschriften des Monats zusammen genau den offenen
 * Betrag des Belegs ergeben: Dann wird jede Zeile ganz zugeordnet, jede als eigene Buchung, und der Beleg steht auf 0,00 €.
 * Sonst bleibt es bei den Gebühren; eine Gutschrift wird nie mit einer Gebühr verrechnet. Einzelaufzeichnung nach § 146
 * Abs. 1 Satz 1 AO (https://www.gesetze-im-internet.de/ao_1977/__146.html) und GoBD Rz. 36 ff.
 */
export async function allocateFeesToDocument(actor: string, input: z.infer<typeof feesSchema>): Promise<number> {
  return withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const [chosen] = await tx
      .select({ bankAccountId: schema.bankTransactions.bankAccountId, bookingDate: schema.bankTransactions.bookingDate, purpose: schema.bankAccounts.purpose })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId))
      .where(eq(schema.bankTransactions.id, input.transactionId));
    if (!chosen) throw new BankError("Umsatz nicht gefunden.");
    if (chosen.purpose !== "zahlungsdienstleister") throw new BankError("Sammelrechnungen gibt es nur für Gebühren eines Zahlungsdienstleisters.");
    const month = chosen.bookingDate.slice(0, 7);
    const kandidaten = await tx
      .select({ id: schema.bankTransactions.id, amount: schema.bankTransactions.amount })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.bankAccountId, chosen.bankAccountId),
          sql`to_char(${schema.bankTransactions.bookingDate}, 'YYYY-MM') = ${month}`,
          sql`${schema.bankTransactions.purpose} like 'Gebühr%'`,
          sql`${openAmountSql} <> 0`,
          bankDuplicateProposalEligibleSql,
        ),
      )
      .orderBy(asc(schema.bankTransactions.bookingDate), asc(schema.bankTransactions.id));
    // Wie die Einzelzuordnung zuerst die Umsätze, dann den Beleg sperren.
    const eligibleIds = await lockEligibleFees(
      tx,
      input.transactionId,
      kandidaten.map((row) => row.id),
    );
    const rows = kandidaten.filter((row) => eligibleIds.has(row.id));
    const fees = rows.filter((row) => row.amount < 0);
    const [doc] = await tx.select({ gross: schema.documents.gross }).from(schema.documents).where(eq(schema.documents.id, input.documentId)).for("update");
    if (!doc) throw new BankError("Beleg nicht gefunden.");
    const offen = async () => documentOpen(doc.gross, await settledOn(tx, "document_id", input.documentId));
    if (rows.length > fees.length) {
      // Nach einer Wartezeit können die offenen Beträge aus der ersten Abfrage veraltet sein; unter den Sperren neu lesen.
      const banks = [];
      for (const row of rows) {
        const bank = await lockTransaction(tx, row.id);
        if (bank.open !== 0) banks.push(bank);
      }
      const open = await offen();
      if (open !== 0 && banks.reduce((sum, bank) => sum + bank.open, 0) === open) {
        // Die Summe stimmt erst nach der letzten Zeile; dazwischen darf der Beleg über- oder unterschritten sein
        for (const bank of banks) {
          await bookPart(tx, company, bank, { kind: "document", documentId: input.documentId, amount: bank.open, sammel: true }, null);
        }
        // Ersetzt die Prüfung je Zeile: Am Ende steht der Beleg genau auf 0,00 €, sonst wird nichts gebucht
        if ((await offen()) !== 0) throw new BankError("Der Beleg oder die Zeilen haben sich zwischenzeitlich geändert; bitte erneut zuordnen.");
        return banks.length;
      }
    }
    let count = 0;
    for (const fee of fees) {
      const bank = await lockTransaction(tx, fee.id);
      // Während des Wartens auf die Sperren erledigt, etwa durch eine Einzelzuordnung
      if (bank.open === 0) continue;
      const open = await offen();
      if (open === 0 || Math.sign(open) !== Math.sign(bank.open)) break;
      const amount = Math.abs(bank.open) <= Math.abs(open) ? bank.open : open;
      await bookPart(tx, company, bank, { kind: "document", documentId: input.documentId, amount }, null);
      count++;
    }
    if (count === 0) throw new BankError("Keine offene Gebühr in diesem Monat, oder der Beleg ist schon erledigt.");
    return count;
  });
}
