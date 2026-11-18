import { taxOf, type BasisPoints, type Cents } from "./money.ts";
import { paidTaxShares, type Versteuerung } from "./posting.ts";

/** Ein Beleg aus der Altbuchhaltung (Lexoffice), Beträge in Cent, Gutschriften negativ */
export interface LegacyVatVoucher {
  direction: "einnahme" | "ausgabe";
  date: string;
  net: Cents;
  tax: Cents;
  gross: Cents;
  taxes: { rate: BasisPoints; net: Cents; tax: Cents }[];
  /** Zahlungen mit Datum; nur für die Ist-Versteuerung gebraucht */
  payments: { date: string; amount: Cents }[];
  /** Steuerart aus Lexoffice (taxConditions.taxType bzw. taxType), fehlt = regulär */
  taxType?: string | null;
  /** taxConditions.taxSubType: "distanceSales" oder "electronicServices" bei Umsätzen über das OSS-Verfahren */
  taxSubType?: string | null;
  /**
   * Eigene Steuerart (sevDesk: taxType custom, Kennzahlen aus GET /TaxSet). Gilt statt taxType, wenn Haben die Kennzahlen
   * kennt; undefined, wenn der Beleg keine eigene Steuerart hat; null, wenn sie fehlt (Steuerarten nicht abgerufen).
   */
  vatFields?: LegacyVatFields | null;
}

/** Kennzahlen einer eigenen Steuerart: Bemessungsgrundlage, Steuer (oft Steuer und Vorsteuer, z. B. Kz 47 und 67) und Satz */
export interface LegacyVatFields {
  rate: BasisPoints;
  net: string | null;
  tax: string[];
}

export interface LegacyVatMonth {
  /** YYYY-MM */
  month: string;
  kz81: Cents;
  tax81: Cents;
  kz86: Cents;
  tax86: Cents;
  /** Umsätze zu 0 % nach § 12 Abs. 3 UStG (Photovoltaik) */
  kz87: Cents;
  /** Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr. */
  kz41: Cents;
  /** Steuerfreie Ausfuhrlieferungen ins Drittland */
  kz43: Cents;
  /** Sonstige Leistungen ins EU-Ausland, Steuer schuldet der Empfänger */
  kz21: Cents;
  /** Nicht steuerbare Leistungen ins Drittland */
  kz45: Cents;
  /** Inländische Umsätze, für die der Empfänger die Steuer nach § 13b UStG schuldet (etwa Bauleistungen) */
  kz60: Cents;
  /** „vatfree“: steuerfrei, ohne Angabe warum. Kz 48 bei § 4 Nr. 8–28 UStG, bei Kleinunternehmern gar nicht gemeldet */
  steuerfrei: Cents;
  /** Fernverkäufe und elektronische Dienstleistungen über das OSS-Verfahren, nicht in der Voranmeldung */
  oss: Cents;
  /** Umsätze zu anderen Sätzen (0 %, Altsätze 16 %/5 %) und unbekannte Steuerarten, nur zur Information */
  otherBase: Cents;
  kz66: Cents;
  /** Bezug von Leistungen, für die du als Empfänger die Steuer schuldest (§ 13b UStG): Bemessungsgrundlagen Kz 46, 84 und Steuer Kz 47, 85 */
  kz46: Cents;
  kz47: Cents;
  kz84: Cents;
  kz85: Cents;
  /** Vorsteuer aus § 13b UStG */
  kz67: Cents;
  /** Innergemeinschaftlicher Erwerb zu 19 % und 7 % (Bemessungsgrundlage), Vorsteuer daraus Kz 61 */
  kz89: Cents;
  kz93: Cents;
  kz61: Cents;
  /** Ausgaben mit eigener Steuerart, deren Kennzahlen Haben nicht kennt oder nicht abgerufen hat: netto, nur zur Information */
  otherPurchases: Cents;
}

type Bucket = "regulaer" | "kz87" | "kz41" | "kz43" | "kz21" | "kz45" | "kz60" | "steuerfrei" | "oss" | "otherBase";

/**
 * Steuerarten von Lexware Office (taxConditions.taxType) und wohin sie in der Voranmeldung gehören.
 * Kennzahlen, die sich nach dem Zeitpunkt der Leistung richten und nicht nach der Zahlung, zählen
 * auch bei Ist-Versteuerung im Monat des Belegdatums (Näherung wie in Haben selbst).
 */
const TAX_TYPES: Record<string, { bucket: Bucket; byVoucherDate: boolean }> = {
  net: { bucket: "regulaer", byVoucherDate: false },
  gross: { bucket: "regulaer", byVoucherDate: false },
  vatfree: { bucket: "steuerfrei", byVoucherDate: false },
  intraCommunitySupply: { bucket: "kz41", byVoucherDate: true },
  constructionService13b: { bucket: "kz60", byVoucherDate: true },
  externalService13b: { bucket: "kz21", byVoucherDate: true },
  thirdPartyCountryService: { bucket: "kz45", byVoucherDate: false },
  thirdPartyCountryDelivery: { bucket: "kz43", byVoucherDate: false },
  photovoltaicEquipment: { bucket: "kz87", byVoucherDate: false },
  // sevDesk-Steuerregeln 18 bis 20 (One-Stop-Shop); Lexoffice meldet OSS über taxSubType
  oss: { bucket: "oss", byVoucherDate: false },
};

/** Steuerarten, die die Nachrechnung kennt; alles andere landet unter „andere“ */
export const LEGACY_TAX_TYPES = Object.keys(TAX_TYPES);

/**
 * Eigene Steuerart auf der Einnahmenseite: Kennzahl der Bemessungsgrundlage → Steuerart wie bei Lexoffice. Ohne Kennzahl
 * meldet die Steuerart nichts (etwa § 19 UStG) und zählt wie „steuerfrei“.
 */
const REVENUE_FIELDS: Record<string, string> = {
  "81": "net",
  "86": "net",
  "41": "intraCommunitySupply",
  "43": "thirdPartyCountryDelivery",
  "21": "externalService13b",
  "45": "thirdPartyCountryService",
  "60": "constructionService13b",
  "87": "photovoltaicEquipment",
  "48": "vatfree",
};

type PurchaseField = "kz46" | "kz84" | "kz89" | "kz93";
type TaxField = "kz47" | "kz85" | "kz67" | "kz61" | "kz66";

/** Eigene Steuerart auf der Ausgabenseite: Bemessungsgrundlagen und Steuer der Bezüge (Vordruckmuster USt 1 A) */
const PURCHASE_FIELDS: Record<string, PurchaseField> = { "46": "kz46", "84": "kz84", "89": "kz89", "93": "kz93" };
const TAX_FIELDS: Record<string, TaxField> = { "47": "kz47", "85": "kz85", "67": "kz67", "61": "kz61", "66": "kz66" };

/** Steuerart von Lexoffice für eine Einnahme mit eigener Steuerart; null, wenn Haben die Kennzahlen nicht kennt */
function revenueTaxType(fields: LegacyVatFields): string | null {
  if (fields.tax.length > 0) return null;
  if (fields.net === null) return "vatfree";
  return REVENUE_FIELDS[fields.net] ?? null;
}

/** Kennzahlen einer Ausgabe mit eigener Steuerart; null, wenn Haben eine davon nicht kennt */
function purchaseFields(fields: LegacyVatFields): { base: PurchaseField | null; tax: TaxField[] } | null {
  const base = fields.net === null ? null : (PURCHASE_FIELDS[fields.net] ?? undefined);
  const tax = fields.tax.map((f) => TAX_FIELDS[f]);
  if (base === undefined || tax.some((f) => f === undefined)) return null;
  return { base, tax: tax as TaxField[] };
}

const OTHER = { bucket: "otherBase" as const, byVoucherDate: false };

function classify(taxType: string | null | undefined, taxSubType: string | null | undefined) {
  if (taxSubType === "distanceSales" || taxSubType === "electronicServices") return { bucket: "oss" as const, byVoucherDate: false };
  if (!taxType) return TAX_TYPES.net!;
  return TAX_TYPES[taxType] ?? OTHER;
}

/** Ohne abgerufene Steuerart oder mit unbekannten Kennzahlen: „Andere Sätze“ */
function classifyCustom(fields: LegacyVatFields | null) {
  const taxType = fields && revenueTaxType(fields);
  return (taxType && TAX_TYPES[taxType]) || OTHER;
}

function emptyMonth(month: string): LegacyVatMonth {
  return {
    month,
    kz81: 0,
    tax81: 0,
    kz86: 0,
    tax86: 0,
    kz87: 0,
    kz41: 0,
    kz43: 0,
    kz21: 0,
    kz45: 0,
    kz60: 0,
    steuerfrei: 0,
    oss: 0,
    otherBase: 0,
    kz66: 0,
    kz46: 0,
    kz47: 0,
    kz84: 0,
    kz85: 0,
    kz67: 0,
    kz89: 0,
    kz93: 0,
    kz61: 0,
    otherPurchases: 0,
  };
}

/**
 * Umsatzsteuer je Monat aus den Lexoffice-Belegen, zum Abgleich mit den übermittelten Voranmeldungen.
 * Einnahmen: Soll nach Belegdatum, Ist anteilig nach Zahlungsdatum. Vorsteuer nach Belegdatum.
 * Die Steuerart des Belegs entscheidet über die Kennzahl (siehe TAX_TYPES), eine eigene Steuerart aus sevDesk über die
 * Kennzahlen, die sie nennt. Bei Bezügen mit Steuerkennzahl (§ 13b, innergemeinschaftlicher Erwerb) rechnet Haben die Steuer
 * je Beleg aus Netto und Satz der Steuerart, wie sevDesk; die Steuer im Beleg zählt dann nicht als Vorsteuer Kz 66.
 * Ergebnis aufsteigend nach Monat; Monate ohne Werte fehlen.
 */
export function legacyVatByMonth(vouchers: LegacyVatVoucher[], versteuerung: Versteuerung): LegacyVatMonth[] {
  const months = new Map<string, LegacyVatMonth>();
  const at = (date: string) => {
    const key = date.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = emptyMonth(key);
      months.set(key, month);
    }
    return month;
  };
  const addRevenue = (date: string, bucket: Bucket, rows: { rate: BasisPoints; base: Cents; tax: Cents }[]) => {
    const month = at(date);
    for (const row of rows) {
      if (bucket !== "regulaer") {
        month[bucket] += row.base;
      } else if (row.rate === 1900) {
        month.kz81 += row.base;
        month.tax81 += row.tax;
      } else if (row.rate === 700) {
        month.kz86 += row.base;
        month.tax86 += row.tax;
      } else {
        month.otherBase += row.base;
      }
    }
  };

  for (const voucher of vouchers) {
    if (voucher.direction === "ausgabe") {
      addPurchase(at(voucher.date), voucher);
      continue;
    }
    const { bucket, byVoucherDate } = voucher.vatFields === undefined ? classify(voucher.taxType, voucher.taxSubType) : classifyCustom(voucher.vatFields);
    if (versteuerung === "soll" || byVoucherDate) {
      addRevenue(
        voucher.date,
        bucket,
        voucher.taxes.map((t) => ({ rate: t.rate, base: t.net, tax: t.tax })),
      );
      continue;
    }
    const totals = {
      net: voucher.net,
      tax: voucher.tax,
      gross: voucher.gross,
      taxes: voucher.taxes.map((t) => ({ rate: t.rate, base: t.net, tax: t.tax })),
    };
    for (const payment of voucher.payments) {
      addRevenue(payment.date, bucket, paidTaxShares(totals, payment.amount));
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Ausgabe nach Belegdatum: Vorsteuer Kz 66, bei eigener Steuerart die Kennzahlen, die sie nennt */
function addPurchase(month: LegacyVatMonth, voucher: LegacyVatVoucher) {
  if (voucher.vatFields === undefined) {
    month.kz66 += voucher.tax;
    return;
  }
  const fields = voucher.vatFields && purchaseFields(voucher.vatFields);
  if (!fields) {
    month.otherPurchases += voucher.net;
    month.kz66 += voucher.tax;
    return;
  }
  if (fields.base) month[fields.base] += voucher.net;
  if (fields.tax.length === 0) {
    month.kz66 += voucher.tax;
    return;
  }
  const tax = taxOf(voucher.net, voucher.vatFields!.rate);
  for (const field of fields.tax) month[field] += tax;
}
