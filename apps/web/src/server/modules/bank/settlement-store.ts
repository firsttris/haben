import { schema, type Tx } from "../../db/index.ts";
import { withAdvanceVatChange } from "../rechnungen/index.ts";

/**
 * Einzige Schreiber der Zahlungsnebenbücher. Auch Gegenzeilen laufen hierdurch: Die Pflicht-Steuerumbuchung
 * gehört zur Persistenz und lässt sich in einem neuen Zahlungsweg nicht vergessen (settlement-store.test.ts).
 * Rechnungsschreiber laden zuvor mit lockInvoice, damit die Sperre vor der ersten Audit-Änderung gehalten wird.
 */
export function insertAllocation(tx: Tx, values: typeof schema.allocations.$inferInsert) {
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.allocations).values(values).returning());
}

export function insertCashEntry(tx: Tx, values: typeof schema.cashEntries.$inferInsert) {
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.cashEntries).values(values).returning());
}

export function insertWriteOff(tx: Tx, values: typeof schema.writeOffs.$inferInsert) {
  return withAdvanceVatChange(tx, values.invoiceId ?? null, () => tx.insert(schema.writeOffs).values(values).returning());
}
