import type { Rechtsform } from "@haben/core";
import type { schema, Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Deduction = Pick<typeof schema.invoiceLines.$inferSelect, "deductionOf">;

export interface AdvanceProcedure {
  advanceAccounting: "deferred" | null;
  replacesInvoiceId: string | null;
}

export class AdvanceProcedureError extends UserError {}

/** Verfahrensentscheidung beim Festschreiben; Altbelege und deren Korrekturketten bleiben unverändert (#750). */
export async function advanceProcedure(
  _invoice: Invoice,
  _lines: readonly Deduction[],
  _company: { rechtsform: Rechtsform },
  _tx: Tx,
): Promise<AdvanceProcedure> {
  throw new Error("Anzahlungsverfahren noch nicht implementiert (#750)");
}
