import { roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";

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

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
