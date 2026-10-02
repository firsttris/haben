import type { BasisPoints, Cents } from "./money.ts";
import type { InvoiceTotals } from "./invoice.ts";

export type Kontenrahmen = "SKR03" | "SKR04";
export type Versteuerung = "ist" | "soll";

/** Konten, die Haben bisher bebucht. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const ACCOUNTS = {
  SKR03: {
    forderungen: "1400",
    bank: "1200",
    erloese: { 1900: "8400", 700: "8300", 0: "8200" },
    ust: { 1900: "1776", 700: "1771" },
    ustNichtFaellig: { 1900: "1766", 700: "1761" },
  },
  SKR04: {
    forderungen: "1200",
    bank: "1800",
    erloese: { 1900: "4400", 700: "4300", 0: "4200" },
    ust: { 1900: "3806", 700: "3801" },
    ustNichtFaellig: { 1900: "3816", 700: "3811" },
  },
} as const;

export const ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "1200": "Bank",
    "1400": "Forderungen aus Lieferungen und Leistungen",
    "1761": "Umsatzsteuer nicht fällig 7 %",
    "1766": "Umsatzsteuer nicht fällig 19 %",
    "1771": "Umsatzsteuer 7 %",
    "1776": "Umsatzsteuer 19 %",
    "8200": "Erlöse",
    "8300": "Erlöse 7 % USt",
    "8400": "Erlöse 19 % USt",
  },
  SKR04: {
    "1200": "Forderungen aus Lieferungen und Leistungen",
    "1800": "Bank",
    "3801": "Umsatzsteuer 7 %",
    "3806": "Umsatzsteuer 19 %",
    "3811": "Umsatzsteuer nicht fällig 7 %",
    "3816": "Umsatzsteuer nicht fällig 19 %",
    "4200": "Erlöse",
    "4300": "Erlöse 7 % USt",
    "4400": "Erlöse 19 % USt",
  },
};

/** Steuerschlüssel mit Kennzahl der Voranmeldung */
export const TAX_CODES = {
  USt19: { rate: 1900, kz: "81", name: "Umsatzsteuer 19 %" },
  USt7: { rate: 700, kz: "86", name: "Umsatzsteuer 7 %" },
  frei: { rate: 0, kz: null, name: "Ohne Umsatzsteuer" },
} as const;

export type TaxCode = keyof typeof TAX_CODES;

export function revenueTaxCode(rate: BasisPoints): TaxCode {
  if (rate === 1900) return "USt19";
  if (rate === 700) return "USt7";
  if (rate === 0) return "frei";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

export interface PostingLine {
  account: string;
  debit: Cents;
  credit: Cents;
  taxCode: TaxCode | null;
}

function side(account: string, amount: Cents, debitIfPositive: boolean, taxCode: TaxCode | null): PostingLine {
  const debit = debitIfPositive ? amount > 0 : amount < 0;
  return { account, debit: debit ? Math.abs(amount) : 0, credit: debit ? 0 : Math.abs(amount), taxCode };
}

/**
 * Buchung einer festgeschriebenen Ausgangsrechnung: Forderung an Erlöse und Umsatzsteuer.
 * Bei Ist-Versteuerung auf „Umsatzsteuer nicht fällig“; fällig wird sie mit dem Zahlungseingang.
 * Negative Summen (Storno, Korrektur) drehen die Seiten.
 */
export function invoicePosting(totals: InvoiceTotals, kontenrahmen: Kontenrahmen, versteuerung: Versteuerung): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.forderungen, totals.gross, true, null)];
  for (const { rate, base, tax } of totals.taxes) {
    const code = revenueTaxCode(rate);
    if (base !== 0) lines.push(side(accounts.erloese[rate as 1900 | 700 | 0], base, false, code));
    if (tax !== 0) {
      const taxAccounts = versteuerung === "ist" ? accounts.ustNichtFaellig : accounts.ust;
      lines.push(side(taxAccounts[rate as 1900 | 700], tax, false, code));
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}
