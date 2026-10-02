import type { LexContact, LexPayments, LexSalesDocument, LexSalesDocumentType, LexVoucher } from "./types.ts";

/*
 * Reine Abbildungen der Lexware-Office-Antworten auf Haben-Strukturen.
 * Beträge: Euro-Dezimalzahlen → ganze Cent. Steuersätze: Prozent → Basispunkte.
 * Datumswerte: das Kalenderdatum, wie es im ISO-String steht (erste 10 Zeichen).
 * Lexoffice schreibt Ortszeit mit Offset ("2023-02-21T00:00:00.000+01:00");
 * ein Umweg über UTC würde den Tag verschieben.
 */

export interface ImportedContact {
  lexofficeId: string;
  name: string;
  kundennummer: string | null;
  lieferantennummer: string | null;
  /**
   * Straße der ersten Rechnungsadresse (sonst Lieferadresse). Ein Adresszusatz
   * (supplement, z. B. "c/o …", "3. OG") wird in Klammern angehängt:
   * "Hauptstr. 1 (Hinterhaus)"; ohne Straße steht nur der Zusatz da.
   */
  strasse: string;
  plz: string;
  ort: string;
  /** ISO-Ländercode, Standard "DE" */
  land: string;
  /** erste Adresse aus business, office, private, other */
  email: string;
  ustId: string;
  steuernummer: string;
  isCustomer: boolean;
  isVendor: boolean;
  archived: boolean;
}

export type LegacyVoucherType =
  | "invoice"
  | "creditnote"
  | "downpaymentinvoice"
  | "salesinvoice"
  | "salescreditnote"
  | "purchaseinvoice"
  | "purchasecreditnote";

export interface LegacyVoucher {
  lexofficeId: string;
  type: LegacyVoucherType;
  direction: "einnahme" | "ausgabe";
  /** voucherNumber ("" wenn keine) */
  number: string;
  /** YYYY-MM-DD; bei ungeprüften Belegen ohne Belegdatum das Anlagedatum */
  date: string;
  dueDate: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  /** voucherStatus wie geliefert */
  status: string;
  contactLexofficeId: string | null;
  contactName: string;
  currency: string;
  /** Cent; Gutschriften negativ. net + tax === gross gilt immer. */
  net: number;
  tax: number;
  gross: number;
  /** je Steuersatz (Basispunkte), gleiche Vorzeichenregel */
  taxes: { rate: number; net: number; tax: number }[];
  /** nur Buchhaltungsbelege, sonst [] */
  categories: { categoryId: string; net: number; tax: number; rate: number }[];
  /** Datei-IDs der Buchhaltungsbelege; bei Rechnungsmodul-Belegen [] */
  fileIds: string[];
  remark: string;
}

export interface ImportedPayments {
  status: string;
  /** Cent */
  openAmount: number;
  paidDate: string | null;
  items: { type: string; date: string; amount: number }[];
}

// ------------------------------------------------------------ Grundbausteine

/**
 * Euro → Cent. `x * 100` ist binär oft knapp daneben (1.005 * 100 = 100.4999…),
 * daher erst auf 6 Nachkommastellen glätten, dann kaufmännisch (vom Nullpunkt weg) runden.
 */
export function lexToCents(x: number): number {
  const scaled = Number((Math.abs(x) * 100).toFixed(6));
  return Math.sign(x) * Math.round(scaled) + 0; // + 0 macht aus -0 eine 0
}

/** Prozent → Basispunkte (19 → 1900, 7 → 700, 5.5 → 550). */
export function lexToBasisPoints(percent: number): number {
  return Math.round(percent * 100) + 0;
}

/** Kalenderdatum aus einem ISO-String, ohne Zeitzonenumrechnung. */
export function lexDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1]! : null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CREDIT_NOTE_TYPES = new Set<string>(["creditnote", "salescreditnote", "purchasecreditnote"]);
const PURCHASE_TYPES = new Set<string>(["purchaseinvoice", "purchasecreditnote"]);
const VOUCHER_TYPES = new Set<string>(["salesinvoice", "salescreditnote", "purchaseinvoice", "purchasecreditnote"]);

function neg(n: number): number {
  return -n + 0;
}

function signed<T extends { net: number; tax: number }>(items: T[], negative: boolean): T[] {
  return negative ? items.map((i) => ({ ...i, net: neg(i.net), tax: neg(i.tax) })) : items;
}

function requireDate(primary: string | null | undefined, fallback: string | null | undefined, id: string): string {
  const d = lexDate(primary) ?? lexDate(fallback);
  if (!d) throw new Error(`Lexoffice-Beleg ${id} hat kein Belegdatum`);
  return d;
}

// ------------------------------------------------------------ Kontakte

export function mapContact(c: LexContact): ImportedContact {
  const person = [c.person?.firstName, c.person?.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  const name = c.company?.name?.trim() || person;

  const addr = c.addresses?.billing?.[0] ?? c.addresses?.shipping?.[0];
  const street = addr?.street?.trim() ?? "";
  const supplement = addr?.supplement?.trim() ?? "";
  const strasse = street && supplement ? `${street} (${supplement})` : street || supplement;

  const mails = c.emailAddresses;
  const email =
    [mails?.business, mails?.office, mails?.private, mails?.other]
      .flatMap((list) => list ?? [])
      .map((m) => m.trim())
      .find(Boolean) ?? "";

  const number = (n: number | string | null | undefined) => (n == null || n === "" ? null : String(n));

  return {
    lexofficeId: c.id,
    name,
    kundennummer: number(c.roles?.customer?.number),
    lieferantennummer: number(c.roles?.vendor?.number),
    strasse,
    plz: addr?.zip?.trim() ?? "",
    ort: addr?.city?.trim() ?? "",
    land: addr?.countryCode?.trim().toUpperCase() || "DE",
    email,
    ustId: c.company?.vatRegistrationId?.trim() ?? "",
    steuernummer: c.company?.taxNumber?.trim() ?? "",
    isCustomer: c.roles?.customer != null,
    isVendor: c.roles?.vendor != null,
    archived: c.archived ?? false,
  };
}

// ------------------------------------------------------------ Rechnungsmodul

/**
 * Rechnung, Gutschrift oder Abschlagsrechnung aus dem Rechnungsmodul.
 * Beträge aus totalPrice (bei Schlussrechnungen also der volle Rechnungsbetrag,
 * nicht der nach Abzug der Abschläge geforderte Restbetrag `claimedGrossAmount`).
 */
export function mapSalesDocument(type: LexSalesDocumentType, d: LexSalesDocument, id: string): LegacyVoucher {
  const negative = CREDIT_NOTE_TYPES.has(type);
  const tp = d.totalPrice;
  const rateOf = (t: { taxRatePercentage?: number | null; taxRatePercent?: number | null }) =>
    lexToBasisPoints(t.taxRatePercentage ?? t.taxRatePercent ?? 0);

  const perRate = (d.taxAmounts ?? []).map((t) => ({
    rate: rateOf(t),
    net: lexToCents(t.netAmount ?? 0),
    tax: lexToCents(t.taxAmount ?? 0),
  }));

  // Brutto und Steuer sind die verbindlichen Werte des Belegs. Netto wird daraus
  // abgeleitet, damit net + tax === gross auch dann exakt gilt, wenn die drei
  // Einzelwerte getrennt gerundet wurden (sonst entstehen Cent-Differenzen in der Buchhaltung).
  const tax = tp?.totalTaxAmount != null ? lexToCents(tp.totalTaxAmount) : perRate.reduce((s, t) => s + t.tax, 0);
  let gross: number;
  if (tp?.totalGrossAmount != null) gross = lexToCents(tp.totalGrossAmount);
  else if (tp?.totalNetAmount != null) gross = lexToCents(tp.totalNetAmount) + tax;
  else gross = perRate.reduce((s, t) => s + t.net + t.tax, 0);
  const net = gross - tax;

  let taxes = perRate;
  if (taxes.length === 0) {
    // Kleinunternehmer / steuerfrei: keine taxAmounts. Ein Eintrag aus den Summen.
    // Falls doch Steuer ausgewiesen ist, den Satz aus den Positionen ableiten, wenn eindeutig.
    let rate = 0;
    if (tax !== 0) {
      const rates = new Set(
        (d.lineItems ?? [])
          .map((li) => li.unitPrice?.taxRatePercentage)
          .filter((r): r is number => typeof r === "number"),
      );
      if (rates.size === 1) rate = lexToBasisPoints([...rates][0]!);
    }
    taxes = [{ rate, net, tax }];
  }

  const voucherDate = requireDate(d.voucherDate, d.createdDate, id);
  let dueDate = lexDate(d.dueDate);
  const term = d.paymentConditions?.paymentTermDuration;
  if (!dueDate && type !== "creditnote" && typeof term === "number") dueDate = addDays(voucherDate, term);

  const sc = d.shippingConditions;
  const serviceFrom = lexDate(sc?.shippingDate);
  const serviceTo = lexDate(sc?.shippingEndDate) ?? serviceFrom;

  return {
    lexofficeId: id,
    type,
    direction: "einnahme",
    number: d.voucherNumber ?? "",
    date: voucherDate,
    dueDate,
    serviceFrom,
    serviceTo,
    status: d.voucherStatus ?? "",
    contactLexofficeId: d.address?.contactId ?? null,
    contactName: d.address?.name ?? "",
    currency: tp?.currency ?? "EUR",
    net: negative ? neg(net) : net,
    tax: negative ? neg(tax) : tax,
    gross: negative ? neg(gross) : gross,
    taxes: signed(taxes, negative),
    categories: [],
    fileIds: [],
    remark: d.remark ?? "",
  };
}

// ------------------------------------------------------------ Buchhaltungsbelege

/**
 * Buchhaltungsbeleg (/vouchers/{id}). Positionsbeträge sind netto bei
 * taxType "net" und brutto bei taxType "gross" (dann netto = amount − taxAmount).
 * Ungeprüfte Belege ("unchecked") haben oft weder Datum noch Beträge:
 * Datum fällt dann auf createdDate zurück, Beträge sind 0.
 */
export function mapVoucher(v: LexVoucher, id: string): LegacyVoucher {
  if (!VOUCHER_TYPES.has(v.type)) throw new Error(`Unbekannter Lexoffice-Belegtyp „${v.type}“ (Beleg ${id})`);
  const type = v.type as LegacyVoucherType;
  const negative = CREDIT_NOTE_TYPES.has(type);
  const isGross = v.taxType === "gross";

  const categories = (v.voucherItems ?? []).map((item) => {
    const amount = lexToCents(item.amount);
    const tax = lexToCents(item.taxAmount ?? 0);
    return {
      categoryId: item.categoryId ?? "",
      net: isGross ? amount - tax : amount,
      tax,
      rate: lexToBasisPoints(item.taxRatePercent ?? 0),
    };
  });

  const itemTax = categories.reduce((s, c) => s + c.tax, 0);
  const itemGross = categories.reduce((s, c) => s + c.net + c.tax, 0);
  // Wie bei Rechnungen: Brutto und Steuer aus den Belegsummen, Netto abgeleitet.
  const tax = v.totalTaxAmount != null ? lexToCents(v.totalTaxAmount) : itemTax;
  const gross = v.totalGrossAmount != null ? lexToCents(v.totalGrossAmount) : itemGross;
  const net = gross - tax;

  const byRate = new Map<number, { rate: number; net: number; tax: number }>();
  for (const c of categories) {
    const t = byRate.get(c.rate) ?? { rate: c.rate, net: 0, tax: 0 };
    t.net += c.net;
    t.tax += c.tax;
    byRate.set(c.rate, t);
  }
  let taxes = [...byRate.values()];
  if (taxes.length === 0 && (gross !== 0 || tax !== 0)) taxes = [{ rate: 0, net, tax }];

  const shipping = lexDate(v.shippingDate);

  return {
    lexofficeId: id,
    type,
    direction: PURCHASE_TYPES.has(type) ? "ausgabe" : "einnahme",
    number: v.voucherNumber ?? "",
    date: requireDate(v.voucherDate, v.createdDate, id),
    dueDate: lexDate(v.dueDate),
    serviceFrom: shipping,
    serviceTo: shipping,
    status: v.voucherStatus ?? v.status ?? "",
    contactLexofficeId: v.contactId ?? null,
    contactName: v.contactName ?? "",
    currency: v.currency ?? "EUR",
    net: negative ? neg(net) : net,
    tax: negative ? neg(tax) : tax,
    gross: negative ? neg(gross) : gross,
    taxes: signed(taxes, negative),
    categories: signed(categories, negative),
    fileIds: v.files ?? [],
    remark: v.remark ?? "",
  };
}

// ------------------------------------------------------------ Zahlungen

/** Zahlungen in Cent; Vorzeichen wie von der API geliefert. */
export function mapPayments(p: LexPayments): ImportedPayments {
  return {
    status: p.paymentStatus ?? "",
    openAmount: lexToCents(p.openAmount ?? 0),
    paidDate: lexDate(p.paidDate),
    items: (p.paymentItems ?? []).map((i) => ({
      type: i.paymentItemType ?? "",
      date: lexDate(i.postingDate) ?? "",
      amount: lexToCents(i.amount),
    })),
  };
}
