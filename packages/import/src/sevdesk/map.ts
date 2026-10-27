import { lexDate, lexToBasisPoints, lexToCents, type ImportedPayments, type LegacyVoucher, type LegacyVoucherType } from "../lexoffice/map.ts";
import type {
  SevCommunicationWay,
  SevContact,
  SevContactAddress,
  SevCreditNote,
  SevDocumentPos,
  SevInvoice,
  SevVoucher,
  SevVoucherPos,
} from "./types.ts";

/*
 * Reine Abbildungen der sevDesk-Antworten auf dieselben Strukturen wie beim Lexoffice-Import,
 * damit Archiv, Abgleich, offene Posten und Jahresexport beide Quellen gleich behandeln.
 *
 * Die Kennung eines Belegs ist "<art>/<id>" (invoice/123, creditnote/45, voucher/678):
 * sevDesk zählt die IDs je Objektart, eine Rechnung und ein Beleg können dieselbe Zahl haben.
 */

export interface SevImportedContact {
  sevdeskId: string;
  name: string;
  kundennummer: string | null;
  strasse: string;
  plz: string;
  ort: string;
  /** ISO-Ländercode, Standard "DE" */
  land: string;
  email: string;
  ustId: string;
  steuernummer: string;
}

/** Text oder Zahl → Zahl; Leeres und Unlesbares ist 0. */
export function sevNumber(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function cents(value: string | number | null | undefined): number {
  return lexToCents(sevNumber(value));
}

function refId(ref: { id: string | number } | null | undefined): string | null {
  return ref?.id == null || ref.id === "" ? null : String(ref.id);
}

function neg(n: number): number {
  return -n + 0;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function requireDate(primary: string | null | undefined, fallback: string | null | undefined, id: string): string {
  const d = lexDate(primary) ?? lexDate(fallback);
  if (!d) throw new Error(`sevDesk-Beleg ${id} hat kein Belegdatum`);
  return d;
}

// ------------------------------------------------------------ Kontakte

/** Ansprechpartner einer Organisation (parent gesetzt) sind keine eigenen Kontakte. */
export function isSevMainContact(c: SevContact): boolean {
  return refId(c.parent) === null;
}

export function mapSevContact(c: SevContact, address?: SevContactAddress, email?: SevCommunicationWay): SevImportedContact {
  const person = [c.surename, c.familyname]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  return {
    sevdeskId: String(c.id),
    name: c.name?.trim() || person || `Kontakt ${c.id}`,
    kundennummer: c.customerNumber?.trim() || null,
    strasse: address?.street?.trim() ?? "",
    plz: address?.zip?.trim() ?? "",
    ort: address?.city?.trim() ?? "",
    land: address?.country?.code?.trim().toUpperCase() || "DE",
    email: email?.value?.trim() ?? "",
    ustId: c.vatNumber?.trim() ?? "",
    steuernummer: c.taxNumber?.trim() ?? "",
  };
}

/** Erste Adresse bzw. Haupt-E-Mail je Kontakt. */
export function firstByContact<T extends { contact?: { id: string | number } | null; main?: unknown }>(items: Iterable<T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    const contactId = refId(item.contact);
    if (!contactId) continue;
    const isMain = item.main === true || item.main === "1" || item.main === 1;
    if (!out.has(contactId) || isMain) out.set(contactId, item);
  }
  return out;
}

// ------------------------------------------------------------ Steuersätze

type Bucket = { rate: number; net: number; tax: number };

/**
 * Netto und Steuer je Steuersatz aus den Positionen. Maßgeblich sind die Summen des Belegs:
 * Rundungsdifferenzen zwischen Positionen und Kopf landen beim größten Satz, die der Steuer beim größten Satz mit Steuer.
 */
function taxesFromPositions(
  positions: { taxRate?: string | number | null; net: number; tax: number }[],
  net: number,
  tax: number,
): Bucket[] {
  const byRate = new Map<number, Bucket>();
  for (const p of positions) {
    const rate = lexToBasisPoints(sevNumber(p.taxRate));
    const b = byRate.get(rate) ?? { rate, net: 0, tax: 0 };
    b.net += p.net;
    b.tax += p.tax;
    byRate.set(rate, b);
  }
  const buckets = [...byRate.values()];
  if (buckets.length <= 1) {
    if (net === 0 && tax === 0 && buckets.length === 0) return [];
    return [{ rate: buckets[0]?.rate ?? 0, net, tax }];
  }
  const largestOf = (list: Bucket[]) => list.reduce((a, b) => (Math.abs(b.net) > Math.abs(a.net) ? b : a));
  largestOf(buckets).net += net - buckets.reduce((s, b) => s + b.net, 0);
  // Steuerdifferenzen nur auf einen Satz mit Steuer, sonst stünde beim 0-%-Satz Steuer
  const taxed = buckets.filter((b) => b.rate !== 0);
  largestOf(taxed.length > 0 ? taxed : buckets).tax += tax - buckets.reduce((s, b) => s + b.tax, 0);
  return buckets;
}

function positionAmounts(p: SevDocumentPos | SevVoucherPos): { net: number; tax: number } {
  const net = cents(p.sumNet ?? p.sumNetAccounting);
  const grossRaw = p.sumGross ?? p.sumGrossAccounting;
  const taxRaw = p.sumTax ?? p.sumTaxAccounting;
  const tax = taxRaw != null && taxRaw !== "" ? cents(taxRaw) : grossRaw != null && grossRaw !== "" ? cents(grossRaw) - net : 0;
  return { net, tax };
}

// ------------------------------------------------------------ Zahlungen

const PAID = 1000;

/**
 * Zahlungsstand aus paidAmount und payDate. sevDesk liefert keine einzelnen Zahlungen über diese
 * Endpunkte; die bezahlte Summe zählt deshalb als eine Zahlung am letzten Zahldatum.
 */
function payments(statusCode: number, gross: number, paidAmount: string | number | null | undefined, payDate: string | null | undefined, date: string): ImportedPayments {
  const absGross = Math.abs(gross);
  let paid = Math.min(Math.abs(cents(paidAmount)), absGross);
  if (statusCode === PAID) paid = absGross;
  const open = absGross - paid;
  const paidDate = lexDate(payDate) ?? (paid > 0 ? date : null);
  return {
    status: open === 0 ? "balanced" : paid > 0 ? "partlyPaid" : "open",
    openAmount: Math.sign(gross) * open + 0,
    paidDate: open === 0 ? paidDate : null,
    items: paid > 0 && paidDate ? [{ type: "manualPayment", date: paidDate, amount: Math.sign(gross) * paid + 0 }] : [],
  };
}

function statusName(code: number, fallback: string): string {
  if (code === PAID) return "paid";
  if (code === 200 || code === 300 || code === 500 || code === 750 || code === 100) return "open";
  return fallback;
}

export interface SevMappedVoucher {
  voucher: LegacyVoucher;
  payment: ImportedPayments;
}

// ------------------------------------------------------------ Rechnungen

/** Entwürfe, wiederkehrende Vorlagen und Mahnungen sind keine Belege. */
export function isSevInvoiceImportable(i: SevInvoice): boolean {
  const status = sevNumber(i.status);
  if (status <= 100) return false;
  return !["WKR", "MA"].includes((i.invoiceType ?? "RE").toUpperCase());
}

export function mapSevInvoice(i: SevInvoice, positions: SevDocumentPos[]): SevMappedVoucher {
  const id = String(i.id);
  const invoiceType = (i.invoiceType ?? "RE").toUpperCase();
  // Storno: sevDesk schreibt die Beträge teils positiv, teils negativ – als Gutschrift immer negativ
  const storno = invoiceType === "SR";
  const type: LegacyVoucherType = storno ? "creditnote" : invoiceType === "AR" ? "downpaymentinvoice" : "invoice";
  const sign = (n: number) => (storno ? neg(Math.abs(n)) : n);

  const tax = sign(cents(i.sumTax));
  const gross = sign(cents(i.sumGross));
  const net = gross - tax;
  const taxes = taxesFromPositions(
    positions.map((p) => {
      const a = positionAmounts(p);
      return { taxRate: p.taxRate, net: sign(a.net), tax: sign(a.tax) };
    }),
    net,
    tax,
  );

  const date = requireDate(i.invoiceDate, i.create, id);
  const term = sevNumber(i.timeToPay);
  const serviceFrom = lexDate(i.deliveryDate);
  const status = sevNumber(i.status);

  return {
    voucher: {
      lexofficeId: `invoice/${id}`,
      type,
      direction: "einnahme",
      number: i.invoiceNumber?.trim() ?? "",
      date,
      dueDate: !storno && term > 0 ? addDays(date, term) : null,
      serviceFrom,
      serviceTo: lexDate(i.deliveryDateUntil) ?? serviceFrom,
      status: statusName(status, String(i.status ?? "")),
      contactLexofficeId: refId(i.contact),
      contactName: (i.address ?? "").split(/\r?\n/)[0]!.trim(),
      currency: i.currency?.trim() || "EUR",
      net,
      tax,
      gross,
      taxes,
      categories: [],
      fileIds: [],
      remark: i.customerInternalNote?.trim() ?? "",
    },
    payment: payments(status, gross, i.paidAmount, i.payDate, date),
  };
}

export function isSevCreditNoteImportable(c: SevCreditNote): boolean {
  return sevNumber(c.status) > 100;
}

export function mapSevCreditNote(c: SevCreditNote, positions: SevDocumentPos[]): SevMappedVoucher {
  const id = String(c.id);
  const tax = neg(Math.abs(cents(c.sumTax)));
  const gross = neg(Math.abs(cents(c.sumGross)));
  const net = gross - tax;
  const taxes = taxesFromPositions(
    positions.map((p) => {
      const a = positionAmounts(p);
      return { taxRate: p.taxRate, net: neg(Math.abs(a.net)), tax: neg(Math.abs(a.tax)) };
    }),
    net,
    tax,
  );
  const date = requireDate(c.creditNoteDate, c.create, id);
  const serviceFrom = lexDate(c.deliveryDate);
  const status = sevNumber(c.status);
  return {
    voucher: {
      lexofficeId: `creditnote/${id}`,
      type: "creditnote",
      direction: "einnahme",
      number: c.creditNoteNumber?.trim() ?? "",
      date,
      dueDate: null,
      serviceFrom,
      serviceTo: serviceFrom,
      status: statusName(status, String(c.status ?? "")),
      contactLexofficeId: refId(c.contact),
      contactName: (c.address ?? "").split(/\r?\n/)[0]!.trim(),
      currency: c.currency?.trim() || "EUR",
      net,
      tax,
      gross,
      taxes,
      categories: [],
      fileIds: [],
      remark: c.customerInternalNote?.trim() ?? "",
    },
    payment: payments(status, gross, c.paidAmount, c.payDate, date),
  };
}

// ------------------------------------------------------------ Belege

/** Entwürfe und Vorlagen wiederkehrender Belege sind keine Belege. */
export function isSevVoucherImportable(v: SevVoucher): boolean {
  if (sevNumber(v.status) <= 50) return false;
  return (v.voucherType ?? "VOU").toUpperCase() !== "RV";
}

/**
 * Beleg aus der Buchhaltung. creditDebit C ist eine Einnahme, D eine Ausgabe. Negative Summen
 * sind Gutschriften und bleiben negativ, wie beim Lexoffice-Import.
 */
export function mapSevVoucher(v: SevVoucher, positions: SevVoucherPos[]): SevMappedVoucher {
  const id = String(v.id);
  const income = (v.creditDebit ?? "D").toUpperCase() === "C";
  const tax = cents(v.sumTax);
  const gross = cents(v.sumGross);
  const net = gross - tax;
  const credit = gross < 0;
  const type: LegacyVoucherType = income ? (credit ? "salescreditnote" : "salesinvoice") : credit ? "purchasecreditnote" : "purchaseinvoice";

  const categories = positions.map((p) => {
    const a = positionAmounts(p);
    return {
      categoryId: refId(p.accountDatev) ?? refId(p.accountingType) ?? "",
      net: a.net,
      tax: a.tax,
      rate: lexToBasisPoints(sevNumber(p.taxRate)),
    };
  });
  const taxes = taxesFromPositions(
    categories.map((c) => ({ taxRate: c.rate / 100, net: c.net, tax: c.tax })),
    net,
    tax,
  );

  const date = requireDate(v.voucherDate, v.create, id);
  const serviceFrom = lexDate(v.deliveryDate);
  const status = sevNumber(v.status);
  const documentId = refId(v.document);

  return {
    voucher: {
      lexofficeId: `voucher/${id}`,
      type,
      direction: income ? "einnahme" : "ausgabe",
      number: v.description?.trim() ?? "",
      date,
      dueDate: lexDate(v.paymentDeadline),
      serviceFrom,
      serviceTo: lexDate(v.deliveryDateUntil) ?? serviceFrom,
      status: statusName(status, String(v.status ?? "")),
      contactLexofficeId: refId(v.supplier),
      contactName: v.supplierName?.trim() ?? "",
      currency: v.currency?.trim() || "EUR",
      net,
      tax,
      gross,
      taxes,
      categories,
      fileIds: documentId ? [documentId] : [],
      remark: "",
    },
    payment: payments(status, gross, v.paidAmount, v.payDate, date),
  };
}
