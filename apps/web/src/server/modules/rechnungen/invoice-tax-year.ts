import { eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/**
 * Storno und Korrektur berichtigen den ursprünglichen Umsatz (§ 17 Abs. 1 und Abs. 2 Nr. 3 UStG), auch nach einem
 * Versteuerungswechsel. Deshalb folgen Buchung, Zahlung und Voranmeldung dem Jahr der Rechnung am Anfang der Kette.
 * Quelle: https://www.gesetze-im-internet.de/ustg_1980/__17.html
 */
type TaxInvoice = Pick<typeof schema.invoices.$inferSelect, "issueDate" | "correctsId"> &
  Partial<Pick<typeof schema.invoices.$inferSelect, "advanceType" | "serviceFrom" | "serviceTo">>;

export async function invoiceTaxYear(invoice: TaxInvoice, q: Db | Tx = db): Promise<number> {
  let current = invoice;
  while (current.correctsId) {
    const [original] = await q
      .select({ issueDate: schema.invoices.issueDate, correctsId: schema.invoices.correctsId, advanceType: schema.invoices.advanceType,
        serviceFrom: schema.invoices.serviceFrom, serviceTo: schema.invoices.serviceTo })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, current.correctsId));
    if (!original) break;
    current = original;
  }
  // Nur ausdrücklich neue Teilleistungen: Das bei der Leistung geltende Verfahren bleibt auch nach einem Wechsel
  // maßgeblich (UStAE 13.6 Abs. 3). Bestandsrechnungen behalten wie bisher ihr Rechnungsjahr.
  // https://ao.bundesfinanzministerium.de/usth/2023/A-Umsatzsteuergesetz/IV-Steuer-und-Vorsteuer/Paragraf-13/ae-13-6.html
  const date = current.advanceType === "teilleistung" ? (current.serviceTo ?? current.serviceFrom ?? current.issueDate) : current.issueDate;
  return Number(date.slice(0, 4));
}
