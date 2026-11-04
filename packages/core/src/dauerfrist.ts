import type { Cents } from "./money.ts";

/*
 * Dauerfristverlängerung (§ 46–48 UStDV): Voranmeldung und Vorauszahlung einen Monat später. Wer monatlich abgibt,
 * meldet dafür jedes Jahr eine Sondervorauszahlung an und zahlt sie; angerechnet wird sie in der letzten Voranmeldung des
 * Jahres (Kz 39). Wer vierteljährlich abgibt, beantragt die Verlängerung ohne Sondervorauszahlung.
 */

/** Stand je Jahr: besteht die Verlängerung, und welche Sondervorauszahlung ist für das Jahr angemeldet? */
export interface DauerfristSetting {
  year: number;
  active: boolean;
  /** Angemeldete Sondervorauszahlung in Cent (volle Euro); null ohne Anmeldung (vierteljährlich oder noch offen) */
  sondervorauszahlung: Cents | null;
}

/**
 * Besteht die Dauerfristverlängerung im Jahr? Sie gilt, bis das Finanzamt sie widerruft oder du sie zurücknimmt; ein
 * Jahr ohne eigenen Eintrag übernimmt den letzten davor.
 */
export function dauerfristActive(settings: readonly DauerfristSetting[], year: number): boolean {
  const last = settings
    .filter((s) => s.year <= year)
    .sort((a, b) => a.year - b.year)
    .at(-1);
  return last?.active ?? false;
}

/** Für das Jahr angemeldete Sondervorauszahlung, die in der letzten Voranmeldung abgezogen wird (Kz 39) */
export function sondervorauszahlungFor(settings: readonly DauerfristSetting[], year: number): Cents {
  const own = settings.find((s) => s.year === year);
  return own?.active ? (own.sondervorauszahlung ?? 0) : 0;
}

export interface SondervorauszahlungBasis {
  /** Summe der Vorauszahlungen des Vorjahres (Kz 83 der zuletzt gesendeten Voranmeldungen) */
  vorauszahlungen: Cents;
  /** Im Vorjahr abgezogene Sondervorauszahlung (Kz 39); sie hat die Vorauszahlung im Dezember gemindert */
  angerechnet: Cents;
  /** Monate mit Tätigkeit im Vorjahr, angefangene voll; 12 bei ganzjähriger Tätigkeit */
  months: number;
}

/**
 * Sondervorauszahlung nach § 47 UStDV: ein Elftel der Summe der Vorauszahlungen des Vorjahres (Abs. 1), bei Tätigkeit
 * nur in einem Teil des Vorjahres auf ein Jahr hochgerechnet (Abs. 2). Zur Summe gehört die im Vorjahr angerechnete
 * Sondervorauszahlung, denn um sie war die Vorauszahlung für Dezember gemindert. ELSTER erwartet volle Euro (Kz 38),
 * deshalb abgeschnitten; ein Überschuss ergibt 0.
 */
export function sondervorauszahlung({ vorauszahlungen, angerechnet, months }: SondervorauszahlungBasis): Cents {
  if (months < 1 || months > 12) throw new Error(`Monate mit Tätigkeit 1–12, nicht ${months}`);
  const jahr = ((vorauszahlungen + angerechnet) * 12) / months;
  return Math.max(0, Math.trunc(jahr / 11 / 100) * 100);
}
