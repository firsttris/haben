import { addDays } from "./holidays.ts";
import type { Cents } from "./money.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Übernahme offener Posten aus Lexoffice oder sevDesk zum Stichtag: dem letzten Tag der alten Buchhaltung. Gebucht wird
 * am Tag danach, dem ersten Tag in Haben. Offen ist, was am Stichtag offen war; was danach bezahlt wurde, kommt als Zahlung
 * in Haben an und braucht dort den offenen Posten.
 */

/** Zahlungsarten in Lexoffice, die Geld bewegen; Skonto, Mahnkosten, Kursdifferenz und Forderungsausfall zählen nicht als Entgelt */
export const LEGACY_PAYMENT_TYPES: ReadonlySet<string> = new Set([
  "payment",
  "partPaymentFinancialTransaction",
  "partPaymentCashBox",
  "manualPayment",
  "partPaymentCreditNote",
]);

/**
 * Was den offenen Betrag mindert, ohne Geld zu bewegen. Nach dem Stichtag gehören Skonto und Forderungsausfall in die
 * Bücher von Haben: Die Steuer wird für den Zeitraum berichtigt, in dem das Entgelt sich mindert bzw. uneinbringlich wird
 * (§ 17 Abs. 1 Satz 8, Abs. 2 Nr. 1 UStG); am Stichtag war der Betrag offen.
 */
const SETTLING_TYPES: ReadonlySet<string> = new Set(["cashDiscount", "irrecoverableReceivable"]);

/** Status ohne Zahlungsdaten, die „offen“ heißen */
const OPEN_STATUS: ReadonlySet<string> = new Set(["open", "overdue", "sepadebit"]);

export interface LegacyOpenVoucher {
  gross: Cents;
  status: string;
  payment: { openAmount: Cents; items: { type: string; date: string; amount: Cents }[] } | null;
}

export interface LegacyOpenAt {
  /** Offen am Stichtag, ohne Vorzeichen */
  open: Cents;
  /** Davon nach dem Stichtag bezahlt: Diese Zahlungen kommen in Haben an */
  paidAfter: Cents;
  /** Warum sich der Stand am Stichtag nicht sicher bestimmen lässt */
  issue: string | null;
}

/**
 * Offener Betrag am Stichtag: heute offen plus alles, was nach dem Stichtag ausgeglichen wurde. Zahlungen am Stichtag
 * selbst zählen noch zur alten Buchhaltung. Ohne Zahlungsdaten zählt der Status wie bisher (offen = der ganze Betrag).
 */
export function legacyOpenAt(voucher: LegacyOpenVoucher, cutoff: string): LegacyOpenAt {
  const gross = Math.abs(voucher.gross);
  if (!voucher.payment) return { open: OPEN_STATUS.has(voucher.status) ? gross : 0, paidAfter: 0, issue: null };
  const openNow = Math.abs(voucher.payment.openAmount);
  const later = voucher.payment.items.filter((i) => !i.date || i.date > cutoff);
  const sum = (items: typeof later) => items.reduce((s, i) => s + Math.abs(i.amount), 0);
  const paidAfter = sum(later.filter((i) => LEGACY_PAYMENT_TYPES.has(i.type)));
  const open = openNow + sum(later);
  const unknown = later.find((i) => i.date && !LEGACY_PAYMENT_TYPES.has(i.type) && !SETTLING_TYPES.has(i.type));
  const issue = later.some((i) => !i.date)
    ? "Zahlung ohne Datum"
    : unknown
      ? `nach dem Stichtag ausgeglichen mit „${unknown.type}“`
      : open > gross
        ? "Zahlungen passen nicht zum Betrag"
        : null;
  return { open, paidAfter, issue };
}

export interface TakeoverCutoffInput {
  rechtsform: Rechtsform;
  /** Erste Eröffnung im Journal, die nicht storniert ist: Dort beginnen die Bücher in Haben */
  openingDate: string | null;
  /** Letztes Jahr im archivierten DATEV-Stapel */
  stapelYear: number | null;
  /** Letztes Belegdatum in Lexoffice bzw. sevDesk */
  lastVoucherDate: string | null;
  /** Buchungstag der ersten Übernahme eines offenen Postens gegen den Saldenvortrag, ohne Stornos */
  firstTakeoverDate: string | null;
  today: string;
  /** Vom Nutzer gewählt; gilt nur, wenn nichts den Stichtag festlegt, und ist vorher mit takeoverCutoffIssue geprüft */
  requested?: string | null;
}

export interface TakeoverCutoff {
  /** Letzter Tag der alten Buchhaltung */
  date: string;
  /** Erster Tag in Haben: Datum der Buchung gegen den Saldenvortrag */
  bookingDate: string;
  /** Warum der Stichtag feststeht; null = wählbar */
  fixed: string | null;
}

const yearEnd = (year: number) => `${year}-12-31`;
const dayOf = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

function at(date: string, fixed: string | null): TakeoverCutoff {
  return { date, bookingDate: addDays(date, 1), fixed };
}

/**
 * Im Einzelunternehmen legt die erste Übernahme den Stichtag fest (der Tag vor ihrer Buchung): Alle offenen Posten
 * müssen zum selben Tag kommen. Sonst zählte ein späterer Stichtag einen Posten als bezahlt, dessen Zahlung nach dem
 * ersten Tag in Haben liegt und dort ankommt; er bliebe in Haben ohne offenen Posten. GmbH und UG legen ihn über die
 * Eröffnung bzw. den DATEV-Stapel fest.
 */
function cutoffOfFirstTakeover(input: TakeoverCutoffInput): TakeoverCutoff | null {
  if (!input.firstTakeoverDate || isKapitalgesellschaft(input.rechtsform)) return null;
  return at(
    addDays(input.firstTakeoverDate, -1),
    `Die ersten offenen Posten sind zum ${dayOf(input.firstTakeoverDate)} übernommen; alle weiteren kommen zum selben Stichtag, sonst bliebe ein dazwischen bezahlter Posten in Haben offen.`,
  );
}

/**
 * Stichtag der Übernahme. Eine gebuchte Eröffnung legt ihn fest (der Tag davor), im Einzelunternehmen die erste
 * Übernahme eines offenen Postens, bei GmbH und UG der DATEV-Stapel: Dessen Eröffnung steht am 1.1. nach dem letzten
 * Stapeljahr, und nur so enthält ihr Saldo genau die Posten, die am Stichtag offen waren. Sonst ist er der 31.12. des
 * letzten Jahres der alten Buchhaltung; reicht die ins laufende Jahr, im Einzelunternehmen der Tag vor heute (Umzug unter
 * dem Jahr), bei GmbH und UG der 31.12. des Vorjahres, weil ihre Eröffnung immer am 1. Januar steht.
 */
export function takeoverCutoff(input: TakeoverCutoffInput): TakeoverCutoff {
  if (input.openingDate) return at(addDays(input.openingDate, -1), `Die Bücher in Haben beginnen mit der Eröffnung am ${dayOf(input.openingDate)}.`);
  const takenOver = cutoffOfFirstTakeover(input);
  if (takenOver) return takenOver;
  const kapg = isKapitalgesellschaft(input.rechtsform);
  if (kapg && input.stapelYear !== null)
    return at(yearEnd(input.stapelYear), `Die Eröffnung aus dem DATEV-Stapel ${input.stapelYear} steht am 1.1.${input.stapelYear + 1}.`);
  if (input.requested) return at(input.requested, null);
  const currentYear = Number(input.today.slice(0, 4));
  const years = [input.stapelYear, input.lastVoucherDate ? Number(input.lastVoucherDate.slice(0, 4)) : null].filter((y) => y !== null);
  const lastYear = years.length > 0 ? Math.max(...years) : currentYear - 1;
  if (lastYear < currentYear) return at(yearEnd(lastYear), null);
  return at(kapg ? yearEnd(currentYear - 1) : addDays(input.today, -1), null);
}

/** Prüft einen gewählten Stichtag; null = in Ordnung */
export function takeoverCutoffIssue(date: string, rechtsform: Rechtsform, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || addDays(date, 0) !== date) return "Der Stichtag ist kein gültiges Datum.";
  if (date >= today) return "Der Stichtag liegt vor heute: Er ist der letzte Tag der alten Buchhaltung.";
  if (isKapitalgesellschaft(rechtsform) && !date.endsWith("-12-31"))
    return "Bei GmbH und UG ist der Stichtag ein 31. Dezember: Die Eröffnung in Haben steht immer am 1. Januar.";
  return null;
}

/**
 * Prüft einen gewählten Stichtag gegen den, den die erste Übernahme festlegt; null = in Ordnung. Anders als bei der
 * Eröffnung, die einen gewählten Stichtag einfach übergeht, wird ein abweichender abgelehnt: Wer ihn wählt, erwartet die
 * Liste zu diesem Tag, und die Übernahme buchte doch zum alten.
 */
export function takeoverCutoffConflict(requested: string, input: TakeoverCutoffInput): string | null {
  if (input.openingDate) return null;
  const takenOver = cutoffOfFirstTakeover(input);
  if (!takenOver || takenOver.date === requested) return null;
  return `Der Stichtag steht seit der ersten Übernahme offener Posten fest auf dem ${dayOf(takenOver.date)}.`;
}
