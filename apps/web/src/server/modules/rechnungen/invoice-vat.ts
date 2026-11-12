import type { Versteuerung } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { versteuerungForYear } from "../stammdaten/index.ts";
import { invoiceTaxYear } from "./invoice-tax-year.ts";

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

/** Auslands-Meldezeitpunkte (§ 18b UStG) ändern sich hier nicht. */
export const advanceAfterPayment = (invoice: Reference) => ["regulaer", "steuerfrei", "ausfuhr"].includes(invoice.taxTreatment ?? "regulaer");

/** Nur die neuen Soll-Anzahlungen benötigen neben Zahlungen auch die Fälligkeit mit der Schlussleistung. */
export async function managedAdvance(invoice: Reference, q: Db | Tx = db): Promise<Invoice | null> {
  const original = await vatOriginal(invoice, q);
  if (original.advanceType !== "anzahlung" || !advanceAfterPayment(original)) return null;
  return (await versteuerungForYear(Number(original.issueDate.slice(0, 4)), q)) === "soll" ? (original as Invoice) : null;
}

/**
 * Die ausdrücklich erbrachte Teilleistung und die Schlussleistung eines neuen Abschlags zählen bei Soll am Leistungstag.
 * Übrige Rechnungen und Bestandsabschläge behalten ihren bisherigen Zeitpunkt.
 * Quelle: https://www.gesetze-im-internet.de/ustg_1980/__13.html
 */
export async function invoiceVatDate(invoice: Invoice, q: Db | Tx = db): Promise<string> {
  if (invoice.kind !== "rechnung" || !advanceAfterPayment(invoice) || (await invoiceVatMode(invoice, q)) !== "soll") return invoice.issueDate;
  let performance = invoice.advanceType === "teilleistung";
  if (invoice.variant === "schluss") {
    const [advance] = await q
      .select({ id: schema.invoices.id })
      .from(schema.invoiceLines)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
      .where(and(eq(schema.invoiceLines.invoiceId, invoice.id), eq(schema.invoices.advanceType, "anzahlung")))
      .limit(1);
    performance ||= Boolean(advance);
  }
  return performance ? (invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate) : invoice.issueDate;
}
