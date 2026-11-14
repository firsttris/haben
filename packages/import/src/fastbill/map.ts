import { type ImportedPayments, type LegacyVoucher, type LegacyVoucherType, lexDate, lexToBasisPoints, lexToCents } from "../lexoffice/map.ts";
import { taxesFromPositions } from "../sevdesk/steuersaetze.ts";
import type { FbCustomer, FbExpense, FbInvoice, FbInvoiceItem, FbVatItem } from "./types.ts";

/*
 * Reine Abbildungen der FastBill-Antworten auf dieselben Strukturen wie beim Lexoffice- und sevDesk-Import,
 * damit Archiv, Abgleich, offene Posten und Jahresexport alle Quellen gleich behandeln.
 *
 * Die Kennung eines Belegs ist "<art>/<id>" (invoice/123, expense/45): Rechnungen und Ausgaben tragen beide
 * ein Feld INVOICE_ID, ob die Zahlen getrennt zählen, sagt die Doku nicht.
 *
 * Grundlage ist die API-Doku (https://apidocs.fastbill.com/fastbill/en/invoice.html, expense.html), gegen ein echtes
 * Konto noch nicht geprüft. Offen sind vor allem die Felder in PAYMENTS (Teilzahlungen) und woran ein Storno
 * sicher zu erkennen ist.
 */

export interface FbImportedContact {
  fastbillId: string;
  name: string;
  /** FastBill führt nur Kunden; Lieferanten stehen in den Ausgaben bloß als Name. */
  role: "customer";
  kundennummer: string | null;
  strasse: string;
  plz: string;
  ort: string;
  /** ISO-Ländercode, Standard "DE" */
  land: string;
  email: string;
  ustId: string;
}

export interface FbMappedVoucher {
  voucher: LegacyVoucher;
  payment: ImportedPayments;
}

/** Text oder Zahl → Zahl; Leeres und Unlesbares ist 0. FastBill schreibt Dezimalpunkte, ein Komma wird toleriert. */
export function fbNumber(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function cents(value: string | number | null | undefined): number {
  return lexToCents(fbNumber(value));
}

function neg(n: number): number {
  return -n + 0;
}

/** ID oder null; FastBill schreibt für „kein Verweis“ teils 0. */
function idOrNull(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" || s === "0" ? null : s;
}

function text(value: string | number | null | undefined): string {
  return value == null ? "" : String(value).trim();
}

/** Datum, wenn FastBill eines gesetzt hat; "0000-00-00" steht für leer. */
function fbDate(value: string | null | undefined): string | null {
  const d = lexDate(value);
  return d && d !== "0000-00-00" ? d : null;
}

function requireDate(value: string | null | undefined, id: string): string {
  const d = fbDate(value);
  if (!d) throw new Error(`FastBill-Beleg ${id} hat kein Belegdatum`);
  return d;
}

function personName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
}

// ------------------------------------------------------------ Kontakte

export function mapFbCustomer(c: FbCustomer): FbImportedContact {
  const id = String(c.CUSTOMER_ID);
  return {
    fastbillId: id,
    name: c.ORGANIZATION?.trim() || personName(c.FIRST_NAME, c.LAST_NAME) || `Kunde ${id}`,
    role: "customer",
    kundennummer: text(c.CUSTOMER_NUMBER) || null,
    strasse: [c.ADDRESS, c.ADDRESS_2]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(", "),
    plz: c.ZIPCODE?.trim() ?? "",
    ort: c.CITY?.trim() ?? "",
    land: c.COUNTRY_CODE?.trim().toUpperCase() || "DE",
    email: c.EMAIL?.trim() ?? "",
    ustId: c.VAT_ID?.trim() ?? "",
  };
}

// ------------------------------------------------------------ Steuersätze

/**
 * Netto und Steuer je Satz. VAT_ITEMS ist die Aufteilung des Belegs selbst und hat Vorrang; fehlt sie, zählen die
 * Positionen. Maßgeblich bleiben die Summen des Kopfs, Rundungsdifferenzen verteilt taxesFromPositions.
 */
function taxes(vatItems: FbVatItem[] | null | undefined, items: FbInvoiceItem[] | null | undefined, net: number, tax: number, sign: (n: number) => number) {
  const fromVat = (vatItems ?? []).map((v) => ({
    rate: lexToBasisPoints(fbNumber(v.VAT_PERCENT)),
    net: sign(cents(v.COMPLETE_NET)),
    tax: sign(cents(v.VAT_VALUE)),
  }));
  const fromItems = (items ?? []).map((p) => {
    const net = cents(p.COMPLETE_NET);
    const tax = p.VAT_VALUE != null && p.VAT_VALUE !== "" ? cents(p.VAT_VALUE) : cents(p.COMPLETE_GROSS) - net;
    return { rate: lexToBasisPoints(fbNumber(p.VAT_PERCENT)), net: sign(net), tax: sign(tax) };
  });
  return taxesFromPositions(fromVat.length > 0 ? fromVat : fromItems, net, tax);
}

// ------------------------------------------------------------ Zahlungen

/**
 * Zahlungsstand ohne erfundene Einzelzahlungen: Die Felder in PAYMENTS nennt die Doku nicht, deshalb zählt nur der
 * Zustand. Bezahlt heißt PAID_DATE gesetzt oder STATE paid; ein Storno ist ausgeglichen, ohne dass Geld floss.
 * Teilzahlungen sind so nicht zu sehen: Eine teilweise bezahlte Rechnung steht voll offen, bis die Felder geklärt sind.
 */
function payments(gross: number, paid: boolean, voided: boolean, paidDate: string | null): ImportedPayments {
  if (voided) return { status: "balanced", openAmount: 0, paidDate: null, items: [] };
  if (paid) return { status: "balanced", openAmount: 0, paidDate, items: [] };
  return { status: "open", openAmount: gross, paidDate: null, items: [] };
}

// ------------------------------------------------------------ Rechnungen

/** Entwürfe sind keine Belege. Wiederkehrende Vorlagen liefert invoice.get nicht, die kämen aus recurring.get. */
export function isFbInvoiceImportable(i: FbInvoice): boolean {
  return text(i.TYPE).toLowerCase() !== "draft" && text(i.STATE).toLowerCase() !== "draft";
}

/**
 * Stornorechnung: ein Verweis auf die stornierte Rechnung und ein Betrag, der sie aufhebt (TYPE credit oder negatives
 * Brutto). Der Verweis allein reicht nicht: REFERENCED_INVOICE_ID nennt bei einer Rechnung aus einem Angebot das Angebot.
 */
export function isFbCancellation(i: FbInvoice): boolean {
  if (idOrNull(i.REFERENCED_INVOICE_ID) === null) return false;
  return text(i.TYPE).toLowerCase() === "credit" || cents(i.TOTAL) < 0;
}

export function mapFbInvoice(i: FbInvoice): FbMappedVoucher {
  const id = String(i.INVOICE_ID);
  const kind = text(i.TYPE).toLowerCase();
  const subtype = text(i.SUBTYPE).toLowerCase();
  const state = text(i.STATE).toLowerCase();
  const credit = kind === "credit" || isFbCancellation(i);
  const type: LegacyVoucherType = credit ? "creditnote" : subtype === "progress_invoice" ? "downpaymentinvoice" : "invoice";

  // Gutschriften und Stornos immer negativ, gleich wie FastBill sie schreibt; Rechnungen behalten ihr Vorzeichen
  const sign = (n: number) => (credit ? neg(Math.abs(n)) : n);
  const gross = sign(cents(i.TOTAL));
  const tax = sign(cents(i.VAT_TOTAL));
  const net = gross - tax;

  const date = requireDate(i.INVOICE_DATE, id);
  const serviceFrom = fbDate(i.SERVICE_PERIOD_START) ?? fbDate(i.DELIVERY_DATE);
  const paidDate = fbDate(i.PAID_DATE);
  // Eine stornierte Rechnung ist erledigt; die Stornorechnung selbst hebt sie auf und ist es ebenso
  const voided = state === "canceled" || fbNumber(i.IS_CANCELED) === 1 || isFbCancellation(i);
  const paid = !voided && (state === "paid" || paidDate !== null);
  const status = voided ? "voided" : paid ? "paid" : state || "open";

  return {
    voucher: {
      lexofficeId: `invoice/${id}`,
      type,
      direction: "einnahme",
      number: text(i.INVOICE_NUMBER),
      date,
      dueDate: credit ? null : fbDate(i.DUE_DATE),
      serviceFrom,
      serviceTo: fbDate(i.SERVICE_PERIOD_END) ?? serviceFrom,
      status,
      contactLexofficeId: idOrNull(i.CUSTOMER_ID),
      contactName: i.ORGANIZATION?.trim() || personName(i.FIRST_NAME, i.LAST_NAME),
      currency: i.CURRENCY_CODE?.trim().toUpperCase() || "EUR",
      net,
      tax,
      gross,
      taxes: taxes(i.VAT_ITEMS, i.ITEMS, net, tax, sign),
      categories: [],
      fileIds: [],
      remark: i.INVOICE_TITLE?.trim() ?? "",
    },
    payment: payments(gross, paid, voided, paidDate),
  };
}

// ------------------------------------------------------------ Ausgaben

/**
 * Eingangsbeleg. Negative Summen sind Gutschriften des Lieferanten und bleiben negativ, wie beim Lexoffice-Import.
 * Die Kategorie aus FastBill steht als categoryId an jedem Steuersatz. fileIds trägt "expense/<id>", wenn FastBill
 * eine DOCUMENT_URL nennt; die Datei lädt der Umzug über diese Adresse.
 */
export function mapFbExpense(e: FbExpense): FbMappedVoucher {
  const id = String(e.INVOICE_ID);
  const gross = cents(e.TOTAL);
  const tax = cents(e.VAT_TOTAL);
  const net = gross - tax;
  const credit = gross < 0;
  const buckets = taxes(e.VAT_ITEMS, e.ITEMS, net, tax, (n) => n);
  const category = e.CATEGORY?.trim() ?? "";
  const serviceFrom = fbDate(e.SERVICE_PERIOD_START);
  const paidDate = fbDate(e.PAID_DATE);

  return {
    voucher: {
      lexofficeId: `expense/${id}`,
      type: credit ? "purchasecreditnote" : "purchaseinvoice",
      direction: "ausgabe",
      number: text(e.INVOICE_NUMBER),
      date: requireDate(e.INVOICE_DATE, id),
      dueDate: fbDate(e.DUE_DATE),
      serviceFrom,
      serviceTo: fbDate(e.SERVICE_PERIOD_END) ?? serviceFrom,
      status: paidDate ? "paid" : "open",
      contactLexofficeId: null,
      contactName: e.ORGANIZATION?.trim() ?? "",
      currency: e.CURRENCY_CODE?.trim().toUpperCase() || "EUR",
      net,
      tax,
      gross,
      taxes: buckets,
      categories: category ? buckets.map((b) => ({ categoryId: category, net: b.net, tax: b.tax, rate: b.rate })) : [],
      fileIds: e.DOCUMENT_URL?.trim() ? [`expense/${id}`] : [],
      remark: e.NOTE?.trim() ?? "",
    },
    payment: payments(gross, paidDate !== null, false, paidDate),
  };
}
