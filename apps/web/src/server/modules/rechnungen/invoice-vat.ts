import type { Versteuerung } from "@haben/core";
import { eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { versteuerungForYear } from "../stammdaten/index.ts";
import { hasNewAdvance, invoiceTaxYear } from "./invoice-tax-year.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Reference = Pick<Invoice, "issueDate" | "correctsId"> & Partial<Invoice>;

/** Auch Storno und Korrektur behalten den Steuerzeitpunkt der ursprünglichen Rechnung. */
export async function vatOriginal(invoice: Reference, q: Db | Tx = db): Promise<Reference> {
  let current = invoice;
  while (current.correctsId) {
    const [original] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, current.correctsId));
    if (!original) break;
    current = original;
  }
  return current;
}

/** § 13 Abs. 1 Nr. 1 a Satz 4 UStG: neue Anzahlungen werden auch bei Soll zunächst wie Ist gebucht. */
export async function invoiceVatMode(invoice: Reference, q: Db | Tx = db): Promise<Versteuerung> {
  const original = await vatOriginal(invoice, q);
  const mode = await versteuerungForYear(await invoiceTaxYear(original, q), q);
  return original.advanceType === "anzahlung" && advanceAfterPayment(original) ? "ist" : mode;
}

/** Auslandsfälle werden nicht nach vereinnahmten Anzahlungen gemeldet (§ 18b UStG). */
export const advanceAfterPayment = (invoice: Reference) => ["regulaer", "steuerfrei", "ausfuhr"].includes(invoice.taxTreatment ?? "regulaer");

/** Neue Anzahlungen folgen den Zahlungen und dem Verfahren ihrer späteren Leistung, auch nach einem Jahreswechsel. */
export async function managedAdvance(invoice: Reference, q: Db | Tx = db): Promise<Invoice | null> {
  const original = await vatOriginal(invoice, q);
  if (original.advanceType !== "anzahlung" || !advanceAfterPayment(original)) return null;
  return original as Invoice;
}

/** Neue Anzahlungen stellen ihre Steuer getrennt über syncAdvanceVat fällig; ihre Geldbewegung bucht nur Bank/Kasse an Forderungen. */
export async function invoicePaymentMode(invoice: Reference, q: Db | Tx = db): Promise<Versteuerung> {
  return (await managedAdvance(invoice, q)) ? "soll" : invoiceVatMode(invoice, q);
}

/**
 * Die ausdrücklich erbrachte Teilleistung und die Schlussleistung eines neuen Abschlags zählen bei Soll am Leistungstag.
 * Übrige Rechnungen und Bestandsabschläge behalten ihren bisherigen Zeitpunkt.
 * Quelle: https://www.gesetze-im-internet.de/ustg_1980/__13.html
 */
export async function invoiceVatDate(invoice: Invoice, q: Db | Tx = db): Promise<string> {
  if (invoice.kind !== "rechnung") return invoice.issueDate;
  const performance = invoice.advanceType === "teilleistung" || (invoice.variant === "schluss" && (await hasNewAdvance(invoice.id, q)));
  // § 18b Satz 3 UStG: Ausgeführte EU-Dienstleistungen sind auch bei Ist im Leistungsmonat zu melden.
  // https://www.gesetze-im-internet.de/ustg_1980/__18b.html
  if (performance && invoice.taxTreatment === "reverse_charge") return invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate;
  if (!advanceAfterPayment(invoice) || (await invoiceVatMode(invoice, q)) !== "soll") return invoice.issueDate;
  return performance ? (invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate) : invoice.issueDate;
}
