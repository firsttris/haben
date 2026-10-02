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
    vorsteuer: { 1900: "1576", 700: "1571" },
    verbindlichkeiten: "1600",
    privateinlagen: "1890",
    privatentnahmen: "1800",
    geldtransit: "1360",
    ustVorauszahlung: "1780",
    nebenkostenGeldverkehr: "4970",
  },
  SKR04: {
    forderungen: "1200",
    bank: "1800",
    erloese: { 1900: "4400", 700: "4300", 0: "4200" },
    ust: { 1900: "3806", 700: "3801" },
    ustNichtFaellig: { 1900: "3816", 700: "3811" },
    vorsteuer: { 1900: "1406", 700: "1401" },
    verbindlichkeiten: "3300",
    privateinlagen: "2180",
    privatentnahmen: "2100",
    geldtransit: "1460",
    ustVorauszahlung: "3820",
    nebenkostenGeldverkehr: "6855",
  },
} as const;

/**
 * Ausgabenkategorien für Belege mit Aufwandskonto je Kontenrahmen.
 * Vor dem Echtbetrieb mit dem Steuerberater abgleichen.
 */
export const EXPENSE_CATEGORIES = {
  software: { label: "Software und Lizenzen", SKR03: "4964", SKR04: "6837" },
  edv: { label: "Hosting und IT-Dienste", SKR03: "4806", SKR04: "6495" },
  hardware: { label: "Hardware (GWG bis 800 € netto)", SKR03: "0480", SKR04: "0670" },
  telefon: { label: "Telefon", SKR03: "4920", SKR04: "6805" },
  internet: { label: "Internet", SKR03: "4925", SKR04: "6810" },
  buero: { label: "Bürobedarf", SKR03: "4930", SKR04: "6815" },
  literatur: { label: "Fachliteratur", SKR03: "4940", SKR04: "6820" },
  fortbildung: { label: "Fortbildung", SKR03: "4945", SKR04: "6821" },
  fahrtkosten: { label: "Reisekosten: Fahrten", SKR03: "4673", SKR04: "6673" },
  uebernachtung: { label: "Reisekosten: Übernachtung", SKR03: "4676", SKR04: "6680" },
  porto: { label: "Porto", SKR03: "4910", SKR04: "6800" },
  werbung: { label: "Werbung", SKR03: "4600", SKR04: "6600" },
  beratung: { label: "Rechts- und Beratungskosten", SKR03: "4950", SKR04: "6825" },
  buchfuehrung: { label: "Buchführung und Steuerberatung", SKR03: "4955", SKR04: "6830" },
  fremdleistung: { label: "Fremdleistungen", SKR03: "3100", SKR04: "5900" },
  geldverkehr: { label: "Kontoführung und Gebühren", SKR03: "4970", SKR04: "6855" },
  versicherung: { label: "Versicherungen", SKR03: "4360", SKR04: "6400" },
  beitraege: { label: "Beiträge", SKR03: "4380", SKR04: "6420" },
  sonstiges: { label: "Sonstiger Aufwand", SKR03: "4900", SKR04: "6300" },
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as [ExpenseCategory, ...ExpenseCategory[]];

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
  VSt19: { rate: 1900, kz: "66", name: "Vorsteuer 19 %" },
  VSt7: { rate: 700, kz: "66", name: "Vorsteuer 7 %" },
  keineVSt: { rate: 0, kz: null, name: "Ohne Vorsteuer" },
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

export function inputTaxCode(rate: BasisPoints): TaxCode {
  if (rate === 1900) return "VSt19";
  if (rate === 700) return "VSt7";
  if (rate === 0) return "keineVSt";
  throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
}

/** Wie ein Beleg bezahlt wird: offen über die Bank (Abgleich in Phase 4) oder privat ausgelegt. */
export type DocumentPayment = "bank" | "privat";

/**
 * Buchung eines Belegs: Aufwand und Vorsteuer an Verbindlichkeiten
 * (oder Privateinlage, wenn privat bezahlt). Gutschriften (negativ) drehen die Seiten.
 */
export function documentPosting(
  totals: InvoiceTotals,
  category: ExpenseCategory,
  kontenrahmen: Kontenrahmen,
  payment: DocumentPayment,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const expense = EXPENSE_CATEGORIES[category][kontenrahmen];
  const lines: PostingLine[] = [];
  for (const { rate, base, tax } of totals.taxes) {
    const code = inputTaxCode(rate);
    if (base !== 0) lines.push(side(expense, base, true, code));
    if (tax !== 0) lines.push(side(accounts.vorsteuer[rate as 1900 | 700], tax, true, code));
  }
  const counter = payment === "privat" ? accounts.privateinlagen : accounts.verbindlichkeiten;
  lines.push(side(counter, totals.gross, false, null));
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Anteil der Steuer je Satz, der auf eine (Teil-)Zahlung entfällt. Rundung so verteilt,
 * dass die Summe dem gerundeten Gesamtanteil entspricht.
 */
export function paidTaxShares(totals: InvoiceTotals, paid: Cents): { rate: BasisPoints; base: Cents; tax: Cents }[] {
  if (totals.gross === 0) return [];
  const share = (value: Cents) => Math.round((value * paid) / totals.gross);
  const totalTax = share(totals.tax);
  const totalNet = paid - totalTax;
  const rows = totals.taxes.map((t) => ({ rate: t.rate, base: share(t.base), tax: share(t.tax) }));
  // Rundungsrest dem größten Posten zuschlagen
  const largest = rows.reduce((best, row, i) => (Math.abs(row.base) > Math.abs(rows[best]!.base) ? i : best), 0);
  if (rows[largest]) {
    rows[largest]!.tax += totalTax - rows.reduce((s, r) => s + r.tax, 0);
    rows[largest]!.base += totalNet - rows.reduce((s, r) => s + r.base, 0);
  }
  return rows;
}

/**
 * Zahlungseingang auf eine Rechnung: Bank an Forderungen. Bei Ist-Versteuerung wird der
 * Steueranteil der Zahlung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ umgebucht.
 */
export function invoicePaymentPosting(
  totals: InvoiceTotals,
  paid: Cents,
  kontenrahmen: Kontenrahmen,
  versteuerung: Versteuerung,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.bank, paid, true, null), side(accounts.forderungen, paid, false, null)];
  if (versteuerung === "ist") {
    for (const { rate, tax } of paidTaxShares(totals, paid)) {
      if (tax === 0 || rate === 0) continue;
      const code = revenueTaxCode(rate);
      lines.push(side(accounts.ustNichtFaellig[rate as 1900 | 700], tax, true, code));
      lines.push(side(accounts.ust[rate as 1900 | 700], tax, false, code));
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Zahlung eines gebuchten Belegs: Verbindlichkeiten an Bank (amount wie auf dem Konto, Ausgang negativ). */
export function documentPaymentPosting(amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  return [side(accounts.verbindlichkeiten, -amount, true, null), side(accounts.bank, amount, true, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

/** Bankumsätze ohne Rechnung oder Beleg */
export const DIRECT_BOOKINGS = {
  privat: "Privat (Entnahme oder Einlage)",
  geldtransit: "Geldtransit (eigenes Konto)",
  ustVorauszahlung: "Umsatzsteuer an das Finanzamt",
  gebuehren: "Kontoführung und Bankgebühren",
} as const;

export type DirectBooking = keyof typeof DIRECT_BOOKINGS;

export function directPosting(kind: DirectBooking, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const counter =
    kind === "privat"
      ? amount < 0
        ? accounts.privatentnahmen
        : accounts.privateinlagen
      : kind === "geldtransit"
        ? accounts.geldtransit
        : kind === "ustVorauszahlung"
          ? accounts.ustVorauszahlung
          : accounts.nebenkostenGeldverkehr;
  return [side(accounts.bank, amount, true, null), side(counter, amount, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}
