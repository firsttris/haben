import type { Cents } from "./money.ts";

/** Mahnstufen; nach der letzten Mahnung bleibt nur Inkasso oder Mahnbescheid */
export const DUNNING_LEVELS = {
  1: { title: "Zahlungserinnerung", label: "Zahlungserinnerung" },
  2: { title: "Mahnung", label: "1. Mahnung" },
  3: { title: "Letzte Mahnung", label: "Letzte Mahnung" },
} as const;

export type DunningLevel = 1 | 2 | 3;

/** Vorschläge für Einleitung und Schluss je Stufe; im Formular änderbar */
export const DUNNING_TEXTS: Record<DunningLevel, { intro: string; closing: string }> = {
  1: {
    intro:
      "sicher ist es Ihrer Aufmerksamkeit entgangen: Für die folgende Rechnung konnten wir noch keinen Zahlungseingang feststellen. Wir bitten Sie, den offenen Betrag bis zum genannten Datum zu überweisen.",
    closing: "Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  },
  2: {
    intro:
      "leider haben wir auf unsere Zahlungserinnerung keinen Zahlungseingang erhalten. Bitte überweisen Sie den offenen Betrag einschließlich der unten aufgeführten Kosten bis zum genannten Datum.",
    closing: "Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  },
  3: {
    intro:
      "trotz Zahlungserinnerung und Mahnung ist die folgende Rechnung weiterhin offen. Wir fordern Sie letztmalig auf, den Gesamtbetrag bis zum genannten Datum zu überweisen.",
    closing:
      "Geht die Zahlung nicht fristgerecht ein, werden wir ohne weitere Ankündigung gerichtliche Schritte einleiten. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.",
  },
};

/** Zinssatz über dem Basiszinssatz (§ 288 BGB) in Basispunkten: Geschäftskunden 9, Verbraucher 5 Prozentpunkte */
export const DEFAULT_INTEREST_MARKUP = { geschaeftskunde: 900, verbraucher: 500 } as const;

export type CustomerType = keyof typeof DEFAULT_INTEREST_MARKUP;

/** Verzugspauschale für Geschäftskunden (§ 288 Abs. 5 BGB) */
export const LATE_PAYMENT_FLAT_FEE: Cents = 4_000;

const dayIndex = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** Verzugstage: ab dem Tag nach der Fälligkeit bis einschließlich Stichtag */
export function daysOverdue(dueDate: string, until: string): number {
  return Math.max(0, dayIndex(until) - dayIndex(dueDate));
}

/**
 * Verzugszinsen auf den offenen Betrag, taggenau, kaufmännisch gerundet. Bewusst vereinfacht mit 365 Tagen
 * je Jahr, auch im Schaltjahr (dort wären es 366); der Unterschied liegt bei rund 0,3 % der Zinsen.
 */
export function lateInterest(open: Cents, rateBasisPoints: number, days: number): Cents {
  if (open <= 0 || rateBasisPoints <= 0 || days <= 0) return 0;
  return Math.round((open * rateBasisPoints * days) / (10_000 * 365));
}

export interface DunningAmounts {
  open: Cents;
  /** Mahngebühr, soweit sie die Pauschale übersteigt (sie wird auf die Pauschale angerechnet) */
  fee: Cents;
  flatFee: Cents;
  interest: Cents;
  interestRate: number;
  interestDays: number;
  total: Cents;
}

export function dunningAmounts(input: {
  open: Cents;
  dueDate: string;
  date: string;
  fee: Cents;
  flatFee: boolean;
  /** Basiszinssatz plus Aufschlag in Basispunkten; null = keine Zinsen */
  interestRate: number | null;
}): DunningAmounts {
  const interestDays = input.interestRate === null ? 0 : daysOverdue(input.dueDate, input.date);
  const interest = input.interestRate === null ? 0 : lateInterest(input.open, input.interestRate, interestDays);
  // Die Pauschale ist auf Kosten der Rechtsverfolgung anzurechnen (§ 288 Abs. 5 Satz 3 BGB):
  // gefordert wird höchstens der größere der beiden Beträge, nicht ihre Summe.
  const flatFee = input.flatFee ? LATE_PAYMENT_FLAT_FEE : 0;
  const fee = Math.max(0, input.fee - flatFee);
  return {
    open: input.open,
    fee,
    flatFee,
    interest,
    interestRate: input.interestRate ?? 0,
    interestDays,
    total: input.open + fee + flatFee + interest,
  };
}
