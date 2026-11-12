import { eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/**
 * Storno und Korrektur berichtigen den ursprünglichen Umsatz (§ 17 Abs. 1 und Abs. 2 Nr. 3 UStG), auch nach einem
 * Versteuerungswechsel. Deshalb folgen Buchung, Zahlung und Voranmeldung dem Jahr der Rechnung am Anfang der Kette.
 * Quelle: https://www.gesetze-im-internet.de/ustg_1980/__17.html
 */
export async function invoiceTaxYear(invoice: { issueDate: string; correctsId: string | null }, q: Db | Tx = db): Promise<number> {
  let current = invoice;
  while (current.correctsId) {
    const [original] = await q
      .select({ issueDate: schema.invoices.issueDate, correctsId: schema.invoices.correctsId })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, current.correctsId));
    if (!original) break;
    current = original;
  }
  return Number(current.issueDate.slice(0, 4));
}
