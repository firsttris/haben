import { and, eq } from "drizzle-orm";
import { bankPrivateMarkedSql } from "../../db/bank-open.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { withAdvanceVatChange } from "../rechnungen/index.ts";

/**
 * Einzige Schreiber der Zahlungsnebenbücher. Auch Gegenzeilen laufen hierdurch: Die Pflicht-Steuerumbuchung
 * gehört zur Persistenz und lässt sich in einem neuen Zahlungsweg nicht vergessen (settlement-store.test.ts).
 * Rechnungsschreiber laden zuvor mit lockInvoice, damit die Sperre vor der ersten Audit-Änderung gehalten wird.
 */
export async function insertAllocation(tx: Tx, values: typeof schema.allocations.$inferInsert) {
  if (!values.reversesId) await nichtPrivatGekennzeichnet(tx, values.transactionId);
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.allocations).values(values).returning());
}

export function insertCashEntry(tx: Tx, values: typeof schema.cashEntries.$inferInsert) {
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.cashEntries).values(values).returning());
}

export async function insertWriteOff(tx: Tx, values: typeof schema.writeOffs.$inferInsert) {
  if (!values.reversesId) await nichtPrivatGekennzeichnet(tx, values.transactionId);
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.writeOffs).values(values).returning());
}

/**
 * Ein als „privat, kein Betriebsvorgang“ gekennzeichneter Umsatz (#1088) wird erst nach dem Aufheben zugeordnet;
 * sonst wäre er zugeordnet und privat zugleich. Die Zahlungswege sperren den Umsatz vorher (lockTransaction), das
 * Kennzeichnen ebenso (privat.ts).
 */
async function nichtPrivatGekennzeichnet(tx: Tx, transactionId: string | null | undefined) {
  if (!transactionId) return;
  const [marke] = await tx
    .select({ id: schema.bankTransactions.id })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.id, transactionId), bankPrivateMarkedSql));
  if (marke) throw new UserError("Der Umsatz ist als privat gekennzeichnet. Erst die Kennzeichnung aufheben, dann zuordnen.");
}
