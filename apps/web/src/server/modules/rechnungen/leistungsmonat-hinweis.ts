import { eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceVatDate } from "./invoice-tax.ts";
import { leistungsmonatHinweis } from "./leistungsmonat.ts";

/**
 * Hinweis zu einer festgeschriebenen Rechnung, nur wenn der Leistungstag ihre Meldung in einen Zeitraum verschiebt, dessen
 * zuletzt übermittelte Anmeldung vor dem Festschreiben gesendet wurde. Ist-Versteuerung, Anzahlungen, Stornos und
 * Korrekturen meldet Haben nicht nach dem Leistungstag.
 */
export async function leistungsmonatHinweisFuer(invoice: typeof schema.invoices.$inferSelect, q: Db | Tx = db): Promise<string | null> {
  if (invoice.status !== "final" || invoice.kind !== "rechnung") return null;
  const tag = await invoiceVatDate(invoice, q);
  if (tag === invoice.issueDate) return null;
  const gesendet = await q
    .select({
      year: schema.vatReturns.year,
      month: schema.vatReturns.month,
      sentAt: schema.vatReturns.sentAt,
    })
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.status, "sent"))
    .orderBy(schema.vatReturns.sentAt);
  return leistungsmonatHinweis(tag, gesendet, { net: invoice.net, tax: invoice.tax }, invoice.lockedAt);
}
