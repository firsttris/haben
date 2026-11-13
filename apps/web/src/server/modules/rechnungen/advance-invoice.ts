import { invoicePosting, type InvoiceTotals, type Kontenrahmen } from "@haben/core";
import type { schema, Tx } from "../../db/index.ts";
import { invoicePostingMode, invoiceTaxReader } from "./invoice-tax.ts";

type Invoice = typeof schema.invoices.$inferSelect;

/**
 * Neue Anforderung: noch kein bilanzierter Anspruch. Schlussrest: einmalige Leistung; ein Papierstorno oder
 * betragsgleicher Ersatz ändert sie nicht. Echte Entgeltkorrekturen bleiben eigene Buchungen (§ 252 HGB, § 17 UStG).
 * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
export async function advanceInvoicePosting(invoice: Invoice, totals: InvoiceTotals, frame: Kontenrahmen, tx: Tx) {
  const original = await invoiceTaxReader(tx).original(invoice);
  if (original.advanceType === "anzahlung" || invoice.replacesInvoiceId || (invoice.kind === "storno" && original.variant === "schluss")) return null;
  const lines = invoicePosting(totals, frame, await invoicePostingMode(invoice, tx), invoice.taxTreatment);
  if (!lines.length) return null;
  return { date: invoice.kind === "rechnung" ? (invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate) : invoice.issueDate, lines };
}
