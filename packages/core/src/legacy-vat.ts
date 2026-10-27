import type { BasisPoints, Cents } from "./money.ts";
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
};

/** Steuerarten, die die Nachrechnung kennt; alles andere landet unter „andere“ */
export const LEGACY_TAX_TYPES = Object.keys(TAX_TYPES);

function classify(taxType: string | null | undefined, taxSubType: string | null | undefined) {
  if (taxSubType === "distanceSales" || taxSubType === "electronicServices") return { bucket: "oss" as const, byVoucherDate: false };
  if (!taxType) return TAX_TYPES.net!;
  return TAX_TYPES[taxType] ?? { bucket: "otherBase" as const, byVoucherDate: false };
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
  };
}

/**
 * Umsatzsteuer je Monat aus den Lexoffice-Belegen, zum Abgleich mit den übermittelten Voranmeldungen.
 * Einnahmen: Soll nach Belegdatum, Ist anteilig nach Zahlungsdatum. Vorsteuer nach Belegdatum.
 * Die Steuerart des Belegs entscheidet über die Kennzahl (siehe TAX_TYPES).
 * Ergebnis aufsteigend nach Monat; Monate ohne Werte fehlen.
 */
export function legacyVatByMonth(vouchers: LegacyVatVoucher[], versteuerung: Versteuerung): LegacyVatMonth[] {
  const months = new Map<string, LegacyVatMonth>();
  const at = (date: string) => {
    const key = date.slice(0, 7);
    let month = months.get(key);
    if (!month) months.set(key, (month = emptyMonth(key)));
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
      at(voucher.date).kz66 += voucher.tax;
      continue;
    }
    const { bucket, byVoucherDate } = classify(voucher.taxType, voucher.taxSubType);
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
