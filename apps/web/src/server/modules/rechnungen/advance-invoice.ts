import { invoicePosting, type InvoiceTotals, type Kontenrahmen } from "@haben/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { invoicePostingMode, invoiceTaxReader } from "./invoice-tax.ts";

type Invoice = typeof schema.invoices.$inferSelect;

/**
 * Vor der ersten Schlussleistung ist die neue Anforderung nicht bilanziert; ein Papierstorno nimmt eine
 * bereits erbrachte Leistung nicht zurück. § 252 Abs. 1 Nr. 4 HGB, bestätigte Grenze:
 * https://github.com/firsttris/haben/issues/750#issuecomment-6850907108
 */
export async function unbilledAdvanceRequest(invoice: Invoice, date: string, tx: Tx): Promise<boolean> {
  if (invoice.advanceAccounting !== "deferred") return false;
  const original = await invoiceTaxReader(tx).original(invoice);
  if (original.advanceType !== "anzahlung") return false;
  const [performed] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(
      and(
        eq(schema.invoiceLines.deductionOf, original.id ?? invoice.id),
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.variant, "schluss"),
        eq(schema.invoices.status, "final"),
        eq(schema.invoices.advanceAccounting, "deferred"),
        isNull(schema.invoices.replacesInvoiceId),
        sql`coalesce(${schema.invoices.serviceTo}, ${schema.invoices.serviceFrom}, ${schema.invoices.issueDate}) <= ${date}::date`,
      ),
    )
    .limit(1);
  return !performed;
}

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
