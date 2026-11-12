import { advanceUsesPayments, type Versteuerung } from "@haben/core";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { versteuerungForYear } from "../stammdaten/index.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Reference = Pick<Invoice, "issueDate" | "correctsId"> & Partial<Invoice>;

/** Nur Schlussrechnungen mit neuen Abschlägen: Bestandsbelege behalten ihren bisherigen Zeitpunkt. */
async function hasNewAdvance(id: string, q: Db | Tx): Promise<boolean> {
  const [advance] = await q
    .select({ id: schema.invoices.id })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(and(eq(schema.invoiceLines.invoiceId, id), isNotNull(schema.invoices.advanceType)))
    .limit(1);
  return Boolean(advance);
}

/**
 * Ein Leser je Auswertung/Schreibschritt, nie global: Korrekturkette, Leistungsdatum und Jahresverfahren nur einmal laden.
 * § 17 UStG: Korrekturen folgen dem ursprünglichen Umsatz, auch nach Versteuerungswechsel.
 * § 13 UStG/UStAE 13.6: Bei ausdrücklich erbrachten Leistungen bestimmt das Leistungsjahr das Verfahren.
 */
export function invoiceTaxReader(q: Db | Tx = db) {
  const originals = new Map<string, Promise<Reference>>();
  const performances = new Map<string, Promise<string | null>>();
  const modes = new Map<number, Promise<Versteuerung>>();
  function original(invoice: Reference): Promise<Reference> {
    if (!invoice.correctsId) return Promise.resolve(invoice);
    let found = originals.get(invoice.correctsId);
    if (!found) {
      found = q
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoice.correctsId))
        .then(([row]) => (row ? original(row) : invoice));
      originals.set(invoice.correctsId, found);
    }
    return found;
  }
  async function performanceDate(invoice: Reference): Promise<string | null> {
    const load = async () =>
      invoice.advanceType === "teilleistung" || (invoice.variant === "schluss" && invoice.id && (await hasNewAdvance(invoice.id, q)))
        ? (invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate)
        : null;
    if (!invoice.id) return load();
    let date = performances.get(invoice.id);
    if (!date) {
      date = load();
      performances.set(invoice.id, date);
    }
    return date;
  }
  async function taxYear(invoice: Reference): Promise<number> {
    const first = await original(invoice);
    return Number(((await performanceDate(first)) ?? first.issueDate).slice(0, 4));
  }
  function modeForYear(year: number): Promise<Versteuerung> {
    let mode = modes.get(year);
    if (!mode) {
      mode = versteuerungForYear(year, q);
      modes.set(year, mode);
    }
    return mode;
  }
  async function companyMode(invoice: Reference) {
    return modeForYear(await taxYear(invoice));
  }
  async function managedAdvance(invoice: Reference): Promise<Invoice | null> {
    const first = await original(invoice);
    return first.advanceType === "anzahlung" && advanceUsesPayments(first.taxTreatment ?? "regulaer") ? (first as Invoice) : null;
  }
  // "ist" bedeutet hier Steuer zunächst nicht fällig buchen, nicht die Firmen-Versteuerung wechseln.
  async function postingMode(invoice: Reference): Promise<Versteuerung> {
    return (await managedAdvance(invoice)) ? "ist" : companyMode(invoice);
  }
  // Die Pflicht-Steuerumbuchung macht der Persistenzschreiber; die Zahlung bucht bei neuen Anzahlungen nur Bank/Kasse an Forderung.
  async function paymentPostingMode(invoice: Reference): Promise<Versteuerung> {
    return (await managedAdvance(invoice)) ? "soll" : companyMode(invoice);
  }
  async function date(invoice: Invoice): Promise<string> {
    if (invoice.kind !== "rechnung") return invoice.issueDate;
    const performed = await performanceDate(invoice);
    // § 18b Satz 3 UStG: ausgeführte EU-Dienstleistung auch bei Ist im Leistungsmonat melden.
    if (performed && invoice.taxTreatment === "reverse_charge") return performed;
    return performed && advanceUsesPayments(invoice.taxTreatment) && (await companyMode(invoice)) === "soll" ? performed : invoice.issueDate;
  }
  return { original, taxYear, modeForYear, companyMode, postingMode, paymentPostingMode, managedAdvance, date };
}

export const invoiceTaxYear = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).taxYear(invoice);
export const invoicePostingMode = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).postingMode(invoice);
export const invoicePaymentPostingMode = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).paymentPostingMode(invoice);
export const invoiceVatDate = (invoice: Invoice, q: Db | Tx = db) => invoiceTaxReader(q).date(invoice);
export const managedAdvance = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).managedAdvance(invoice);
