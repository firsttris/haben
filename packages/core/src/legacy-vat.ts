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
}

export interface LegacyVatMonth {
  /** YYYY-MM */
  month: string;
  kz81: Cents;
  tax81: Cents;
  kz86: Cents;
  tax86: Cents;
  /** Umsätze zu anderen Sätzen (0 %, Altsätze 16 %/5 %), nur zur Information */
  otherBase: Cents;
  kz66: Cents;
}

function emptyMonth(month: string): LegacyVatMonth {
  return { month, kz81: 0, tax81: 0, kz86: 0, tax86: 0, otherBase: 0, kz66: 0 };
}

/**
 * Umsatzsteuer je Monat aus den Lexoffice-Belegen, zum Abgleich mit den übermittelten Voranmeldungen.
 * Einnahmen: Soll nach Belegdatum, Ist anteilig nach Zahlungsdatum. Vorsteuer nach Belegdatum.
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
  const addRevenue = (date: string, rows: { rate: BasisPoints; base: Cents; tax: Cents }[]) => {
    const month = at(date);
    for (const row of rows) {
      if (row.rate === 1900) {
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
    if (versteuerung === "soll") {
      addRevenue(
        voucher.date,
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
      addRevenue(payment.date, paidTaxShares(totals, payment.amount));
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
