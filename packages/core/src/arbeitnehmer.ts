import type { Cents } from "./money.ts";
import { homeofficeSatz } from "./pauschalen.ts";

/**
 * Einkünfte aus nichtselbständiger Arbeit (§ 19 EStG) für die Steuerprognose: Bruttoarbeitslohn
 * abzüglich Werbungskosten, mindestens des Arbeitnehmer-Pauschbetrags. Die einbehaltene Lohnsteuer
 * samt Soli und Kirchensteuer wird auf die Jahressteuer angerechnet.
 */

export interface ArbeitslohnBescheinigung {
  brutto: Cents;
  lohnsteuer?: Cents;
  soli?: Cents;
  kirchensteuer?: Cents;
  kirchensteuerEhegatte?: Cents;
  rvArbeitgeber?: Cents;
  rvArbeitnehmer?: Cents;
  kvArbeitnehmer?: Cents;
  pvArbeitnehmer?: Cents;
  avArbeitnehmer?: Cents;
}

export interface Arbeitslohn {
  bescheinigungen: ArbeitslohnBescheinigung[];
  werbungskosten: {
    wege?: { tage: number; km: number };
    homeofficeTage?: number;
    arbeitsmittel?: Cents;
    fortbildung?: Cents;
    berufsverbaende?: Cents;
    sonstige?: Cents;
  };
}

/** Arbeitnehmer-Pauschbetrag (§ 9a Satz 1 Nr. 1a EStG) */
export function arbeitnehmerPauschbetrag(year: number): Cents {
  if (year >= 2023) return 1_230_00;
  if (year >= 2022) return 1_200_00;
  return 1_000_00;
}

/**
 * Entfernungspauschale für ein Jahr (§ 9 Abs. 1 Satz 3 Nr. 4 EStG): je Arbeitstag und vollem Kilometer
 * der einfachen Strecke 0,30 €, ab dem 21. Kilometer 0,35 € (2021) bzw. 0,38 € (2022–2025), ab 2026
 * 0,38 € ab dem ersten Kilometer. Mit dem eigenen Auto ohne Höchstbetrag.
 */
export function entfernungspauschale(year: number, tage: number, km: number): Cents {
  const voll = Math.floor(km);
  if (!(tage > 0) || voll <= 0) return 0;
  const fern = year >= 2022 ? 38 : year === 2021 ? 35 : 30;
  const nah = year >= 2026 ? 38 : 30;
  return Math.floor(tage) * (Math.min(voll, 20) * nah + Math.max(0, voll - 20) * fern);
}

/** Homeoffice-Tagespauschale als Werbungskosten, gedeckelt auf den Jahreshöchstbetrag */
export function homeofficeWerbungskosten(year: number, tage: number | undefined): Cents {
  const satz = homeofficeSatz(year);
  if (!satz || !tage || tage <= 0) return 0;
  return Math.min(Math.floor(tage), satz.maxTage) * satz.proTag;
}

const sum = (values: (Cents | undefined)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

export interface ArbeitslohnErgebnis {
  brutto: Cents;
  /** Tatsächliche Werbungskosten */
  werbungskosten: Cents;
  /** Abgezogen: Werbungskosten oder Pauschbetrag */
  abzug: Cents;
  einkuenfte: Cents;
  /** Einbehaltene Lohnsteuer, Soli und Kirchensteuer */
  steuerabzug: Cents;
}

export function arbeitslohnErgebnis(year: number, an: Arbeitslohn): ArbeitslohnErgebnis {
  const b = an.bescheinigungen;
  const brutto = sum(b.map((x) => x.brutto));
  const w = an.werbungskosten;
  const werbungskosten =
    (w.wege ? entfernungspauschale(year, w.wege.tage, w.wege.km) : 0) +
    homeofficeWerbungskosten(year, w.homeofficeTage) +
    sum([w.arbeitsmittel, w.fortbildung, w.berufsverbaende, w.sonstige]);
  const pausch = arbeitnehmerPauschbetrag(year);
  // Der Pauschbetrag mindert nur bis auf 0; höhere Werbungskosten können einen Verlust ergeben
  const abzug = werbungskosten > pausch ? werbungskosten : Math.min(pausch, brutto);
  return {
    brutto,
    werbungskosten,
    abzug,
    einkuenfte: brutto - abzug,
    steuerabzug: sum(b.flatMap((x) => [x.lohnsteuer, x.soli, x.kirchensteuer, x.kirchensteuerEhegatte])),
  };
}

/** Anteil der Altersvorsorge, der als Sonderausgabe zählt (§ 10 Abs. 3 Satz 6 EStG): 100 % ab 2023 */
export function altersvorsorgeQuote(year: number): number {
  if (year >= 2023) return 1;
  return Math.max(0, 0.9 + (year - 2020) * 0.02);
}
