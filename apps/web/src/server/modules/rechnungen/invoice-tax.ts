import { advanceUsesPayments, type Versteuerung } from "@haben/core";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { versteuerungForYear } from "../stammdaten/index.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type TaxMetadata = Pick<
  Invoice,
  | "id"
  | "issueDate"
  | "correctsId"
  | "replacesInvoiceId"
  | "advanceAccounting"
  | "advanceType"
  | "variant"
  | "kind"
  | "status"
  | "serviceFrom"
  | "serviceTo"
  | "taxTreatment"
  | "number"
>;
type Reference = Pick<TaxMetadata, "issueDate" | "correctsId"> & Partial<TaxMetadata>;

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

/** Nur Steuer- und Verfahrensfelder cachen; PDF/XML gehören nicht zu den Auswertungsreferenzen. */
function invoiceMetadataReader(q: Db | Tx) {
  const snapshots = new Map<string, Promise<TaxMetadata | undefined>>();
  function snapshotById(id: string): Promise<TaxMetadata | undefined> {
    let found = snapshots.get(id);
    if (!found) {
      found = q
        .select({
          id: schema.invoices.id,
          issueDate: schema.invoices.issueDate,
          correctsId: schema.invoices.correctsId,
          replacesInvoiceId: schema.invoices.replacesInvoiceId,
          advanceAccounting: schema.invoices.advanceAccounting,
          advanceType: schema.invoices.advanceType,
          variant: schema.invoices.variant,
          kind: schema.invoices.kind,
          status: schema.invoices.status,
          serviceFrom: schema.invoices.serviceFrom,
          serviceTo: schema.invoices.serviceTo,
          taxTreatment: schema.invoices.taxTreatment,
          number: schema.invoices.number,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, id))
        .then(([row]) => row);
      snapshots.set(id, found);
    }
    return found;
  }
  async function snapshot(invoice: Reference): Promise<Reference> {
    if (!invoice.id) return invoice;
    const stored = await snapshotById(invoice.id);
    if (!stored) return invoice;
    // Journal-/Zahlungsabfragen liefern nur Teilfelder. Lokale Festschreibungswerte gehen vor dem noch offenen Entwurf.
    const supplied = Object.fromEntries(Object.entries(invoice).filter(([, value]) => value !== undefined));
    return { ...stored, ...supplied };
  }
  return { snapshotById, snapshot };
}

/**
 * Ein Leser je Auswertung/Schreibschritt, nie global: Korrekturkette, Leistungsdatum und Jahresverfahren nur einmal laden.
 * § 17 UStG: Korrekturen folgen der ursprünglichen Leistung, auch nach Versteuerungswechsel und Rechnungsaustausch.
 * § 13 UStG/UStAE 13.6: Bei ausdrücklich erbrachten Leistungen bestimmt das Leistungsjahr das Verfahren.
 */
export function invoiceTaxReader(q: Db | Tx = db) {
  const { snapshotById, snapshot } = invoiceMetadataReader(q);
  const originals = new Map<string, Promise<Reference>>();
  const performances = new Map<string, Promise<string | null>>();
  const modes = new Map<number, Promise<Versteuerung>>();
  async function original(invoice: Reference): Promise<Reference> {
    const current = await snapshot(invoice);
    const parentId = current.correctsId ?? (current.advanceAccounting === "deferred" ? current.replacesInvoiceId : null);
    if (!parentId) return current;
    let found = originals.get(parentId);
    if (!found) {
      found = snapshotById(parentId).then((parent) => (parent ? original(parent) : current));
      originals.set(parentId, found);
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
  async function managedAdvance(invoice: Reference): Promise<Reference | null> {
    const first = await original(invoice);
    return first.advanceType === "anzahlung" && advanceUsesPayments(first.taxTreatment ?? "regulaer") ? first : null;
  }
  // "ist" bedeutet hier Steuer zunächst nicht fällig buchen, nicht die Firmen-Versteuerung wechseln.
  async function postingMode(invoice: Reference): Promise<Versteuerung> {
    return (await managedAdvance(invoice)) ? "ist" : companyMode(invoice);
  }
  // Die Pflicht-Steuerumbuchung macht der Persistenzschreiber; die Zahlung bucht bei neuen Anzahlungen nur Bank/Kasse an Forderung.
  async function paymentPostingMode(invoice: Reference): Promise<Versteuerung> {
    return (await managedAdvance(invoice)) ? "soll" : companyMode(invoice);
  }
  /**
   * Derselbe Belegumfang wie im neuen Journalweg: Anforderungen, Papierstornos und Ersatz realisieren nicht erneut.
   * Echte Korrekturen der Schlussleistung bleiben eigene Entgeltänderungen; Altbelege behalten ihr Verfahren.
   * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
   */
  async function invoicePostingAllowed(invoice: Reference): Promise<boolean> {
    const current = await snapshot(invoice);
    const first = await original(current);
    if (first.advanceAccounting !== "deferred") return true;
    return first.advanceType !== "anzahlung" && !current.replacesInvoiceId && !(current.kind === "storno" && first.variant === "schluss");
  }
  async function date(invoice: Invoice): Promise<string> {
    if (invoice.kind !== "rechnung") return invoice.issueDate;
    const performed = await performanceDate(invoice);
    // § 18b Satz 3 UStG: ausgeführte EU-Dienstleistung auch bei Ist im Leistungsmonat melden.
    if (performed && invoice.taxTreatment === "reverse_charge") return performed;
    return performed && advanceUsesPayments(invoice.taxTreatment) && (await companyMode(invoice)) === "soll" ? performed : invoice.issueDate;
  }
  return { original, taxYear, modeForYear, companyMode, postingMode, paymentPostingMode, managedAdvance, invoicePostingAllowed, date };
}

export const invoiceTaxYear = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).taxYear(invoice);
export const invoicePostingMode = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).postingMode(invoice);
export const invoicePaymentPostingMode = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).paymentPostingMode(invoice);
export const invoiceVatDate = (invoice: Invoice, q: Db | Tx = db) => invoiceTaxReader(q).date(invoice);
export const managedAdvance = (invoice: Reference, q: Db | Tx = db) => invoiceTaxReader(q).managedAdvance(invoice);
