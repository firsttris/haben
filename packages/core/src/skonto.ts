import { z } from "zod/mini";
import { addDays, naechsterWerktag } from "./holidays.ts";
import { parseEuro, roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";
import type { Bundesland } from "./steuernummer.ts";

/** Eine Skontostufe aus den Zahlungsbedingungen einer E-Rechnung */
export interface SkontoTerm {
  /** Frist in Tagen */
  days: number;
  /** Satz in Basispunkten: 200 = 2 % */
  percent: BasisPoints;
  /** Grundwert, wenn nicht der ganze Zahlbetrag (BT-115) skontofähig ist */
  base?: Cents;
}

/**
 * Skontozeile in den Zahlungsbedingungen (BT-20) nach XRechnung, Regel BR-DE-18:
 * `#SKONTO#TAGE=7#PROZENT=2.00#`, optional mit `#BASISBETRAG=100.00#`, eine Angabe je Zeile, in Großbuchstaben.
 * Ausdruck XR-SKONTO-REGEX aus itplr-kosit/xrechnung-schematron (common.sch).
 */
const SKONTO_LINE = /^#SKONTO#TAGE=([0-9]+)#PROZENT=([0-9]+)\.([0-9]{2})(?:#BASISBETRAG=(-?[0-9]+)\.([0-9]{2}))?#$/;

/** Skontostufen aus dem Text der Zahlungsbedingungen; Zeilen in anderer Form und Stufen mit 0 % entfallen */
export function parseSkontoTerms(paymentTerms: string): SkontoTerm[] {
  return paymentTerms
    .split(/\r?\n/)
    .map((line) => SKONTO_LINE.exec(line.trim()))
    .flatMap((m) => {
      if (!m) return [];
      const percent = Number(m[2]) * 100 + Number(m[3]);
      if (percent === 0) return [];
      // Betrag ohne Punkt gelesen ist der Betrag in Cent: 100.00 → 10000
      const base = m[4] === undefined ? undefined : Number(`${m[4]}${m[5]}`);
      return [{ days: Number(m[1]), percent, ...(base === undefined ? {} : { base }) }];
    });
}

export interface SkontoOffer {
  term: SkontoTerm;
  /** Letzter Tag der Frist, gezählt ab dem Rechnungsdatum */
  until: string;
  /** Abzug in Cent */
  amount: Cents;
}

/**
 * Höchstes Skonto, dessen Frist am Zahltag noch läuft. Die Frist zählt Haben ab dem Rechnungsdatum (BT-2); der Abzug
 * ist der Satz vom Grundwert, ohne Grundwert vom Zahlbetrag.
 */
export function skontoOffer(terms: SkontoTerm[], invoiceDate: string, paymentDate: string, payable: Cents): SkontoOffer | null {
  const running = terms
    .map((term) => ({ term, until: addDays(invoiceDate, term.days) }))
    .filter((t) => t.until >= paymentDate)
    .sort((a, b) => b.term.percent - a.term.percent);
  const best = running[0];
  if (!best) return null;
  const amount = roundHalfAwayFromZero(((best.term.base ?? payable) * best.term.percent) / 10_000);
  return amount > 0 && amount < payable ? { ...best, amount } : null;
}

/** Skontostufe einer Ausgangsrechnung: Frist in Tagen ab dem Rechnungsdatum, Satz in Basispunkten, immer vom ganzen Betrag */
export type SkontoStufe = Pick<SkontoTerm, "days" | "percent">;

/** Höchstens drei Stufen; die XRechnung erlaubt mehrere Skontozeilen (Testsuite, Fall 01.10a, mit drei Zeilen) */
export const MAX_SKONTO_STUFEN = 3;

export const skontoStufeSchema = z.object({
  days: z.int().check(z.minimum(1, "Skontofrist mindestens 1 Tag"), z.maximum(120, "Skontofrist höchstens 120 Tage")),
  percent: z.int().check(z.minimum(1, "Skonto mindestens 0,01 %"), z.maximum(9_999, "Skonto unter 100 %")),
});

export const SKONTO_STUFEN_MAX_MESSAGE = `Höchstens ${MAX_SKONTO_STUFEN} Skontostufen`;

export const skontoStufenSchema = z.array(skontoStufeSchema).check(z.maxLength(MAX_SKONTO_STUFEN, SKONTO_STUFEN_MAX_MESSAGE));

/** Stufen nach Frist sortiert */
export function sortSkonto<T extends SkontoStufe>(stufen: readonly T[]): T[] {
  return [...stufen].sort((a, b) => a.days - b.days);
}

/**
 * Was an den Stufen nicht stimmt, sonst null: Jede Frist endet spätestens mit dem Zahlungsziel (sonst wäre der
 * Abzug noch nach der Fälligkeit möglich), keine Frist doppelt, und eine längere Frist hat einen kleineren Satz.
 */
export function skontoProblem(stufen: readonly SkontoStufe[], paymentTermDays: number): string | null {
  const sorted = sortSkonto(stufen);
  const late = sorted.find((s) => s.days > paymentTermDays);
  if (late) return `Die Skontofrist von ${late.days} Tagen ist länger als das Zahlungsziel von ${paymentTermDays} Tagen.`;
  for (let i = 1; i < sorted.length; i++) {
    const [before, after] = [sorted[i - 1]!, sorted[i]!];
    if (before.days === after.days) return `Die Skontofrist von ${after.days} Tagen steht doppelt.`;
    if (after.percent >= before.percent) return "Eine längere Skontofrist braucht einen kleineren Satz als die kürzere.";
  }
  return null;
}

/** 200 → "2.00": Prozent mit Punkt und zwei Nachkommastellen, wie BR-DE-18 sie verlangt */
function xrPercent(percent: BasisPoints): string {
  return `${Math.floor(percent / 100)}.${String(percent % 100).padStart(2, "0")}`;
}

/**
 * Skontozeilen für die Zahlungsbedingungen (BT-20) nach XRechnung, Regel BR-DE-18: je Stufe
 * `#SKONTO#TAGE=10#PROZENT=2.00#` und danach ein Zeilenumbruch, auch nach der letzten. Ohne Grundwert, denn das
 * Skonto gilt für den ganzen fälligen Betrag (BT-115). Leer ohne Stufen.
 */
export function skontoPaymentTerms(stufen: readonly SkontoStufe[]): string {
  return sortSkonto(stufen)
    .map((s) => `#SKONTO#TAGE=${s.days}#PROZENT=${xrPercent(s.percent)}#\n`)
    .join("");
}

export interface SkontoFrist extends SkontoStufe {
  /** Letzter Tag der Frist, gezählt ab dem Rechnungsdatum wie in der E-Rechnung (TAGE=n) */
  until: string;
  /** Abzug in Cent */
  amount: Cents;
  /** Zahlbetrag mit Abzug */
  payable: Cents;
}

/**
 * Fristen und Beträge der Stufen für eine Rechnung über `gross`, nach Frist sortiert; der Abzug ist kaufmännisch
 * gerundet. Stufen, die nichts oder alles abzögen, entfallen.
 */
export function skontoFristen(stufen: readonly SkontoStufe[], issueDate: string, gross: Cents): SkontoFrist[] {
  return sortSkonto(stufen).flatMap((s) => {
    const amount = roundHalfAwayFromZero((gross * s.percent) / 10_000);
    if (amount <= 0 || amount >= gross) return [];
    return [{ days: s.days, percent: s.percent, until: addDays(issueDate, s.days), amount, payable: gross - amount }];
  });
}

export interface SkontoZahlfrist extends SkontoFrist {
  /** Letzter Tag, an dem eine Zahlung die Frist noch wahrt: `until` oder der nächste Werktag danach (§ 193 BGB) */
  paidBy: string;
}

/**
 * Fristen wie `skontoFristen` für die Prüfung, ob eine Zahlung in der Frist liegt. Endet die Frist an einem Samstag,
 * Sonntag oder Feiertag im Bundesland der Firma, wahrt nach § 193 BGB eine Zahlung am nächsten Werktag sie noch, wie
 * beim Zahlungsziel (`invoiceDueDate`). Rechnung, PDF, E-Mail und BT-20 nennen weiter das Fristende aus TAGE=n.
 */
export function skontoZahlfristen(stufen: readonly SkontoStufe[], issueDate: string, gross: Cents, bundesland: Bundesland | null): SkontoZahlfrist[] {
  return skontoFristen(stufen, issueDate, gross).map((s) => ({ ...s, paidBy: naechsterWerktag(s.until, bundesland) }));
}

/** "2" oder "2,5 %" → Basispunkte; null, wenn die Eingabe kein Satz mit höchstens zwei Nachkommastellen ist */
export function parsePercent(input: string): BasisPoints | null {
  const value = parseEuro(input.replace(/%/g, ""));
  return value === null || value < 0 ? null : value;
}

const percentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** 250 → "2,5 %" */
export function formatPercent(percent: BasisPoints): string {
  return `${percentFormat.format(percent / 100)}\u00a0%`;
}
