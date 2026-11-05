import type { Cents } from "./money.ts";

/**
 * Regeln der degressiven AfA (§ 7 Abs. 2 EStG) und der AfA für Elektrofahrzeuge (§ 7 Abs. 2a EStG). Den Plan je Jahr
 * rechnet depreciationSchedule in afa.ts.
 */

/** Zeitraum der Anschaffung (ISO-Daten einschließlich), in dem die degressive AfA zulässig ist, und ihre Grenzen */
interface DegressiveWindow {
  from: string;
  to: string;
  /** Höchstens das Vielfache des linearen Satzes … */
  factor: number;
  /** … und höchstens dieser Satz in Basispunkten (3000 = 30 %) */
  cap: number;
  source: string;
}

/**
 * Zeiträume nach dem Wortlaut auf gesetze-im-internet.de (Stand 11/2025):
 * - § 7 Abs. 2 Satz 1 und 2 EStG in der Fassung des Gesetzes für ein steuerliches Investitionssofortprogramm vom
 *   14.07.2025 (BGBl. 2025 I Nr. 161): angeschafft nach dem 30.06.2025 und vor dem 01.01.2028, höchstens das Dreifache
 *   des linearen Satzes und 30 %.
 * - § 52 Abs. 15 Satz 4 EStG: für Anschaffungen nach dem 31.12.2019 und vor dem 01.01.2023 sowie nach dem 31.03.2024 und
 *   vor dem 01.01.2025 gilt § 7 Abs. 2 in der Fassung des Wachstumschancengesetzes vom 27.03.2024 (BGBl. 2024 I Nr. 108)
 *   weiter: 2020 bis 2022 das Zweieinhalbfache und 25 %, April bis Dezember 2024 das Doppelte und 20 %.
 * Ältere Zeiträume (vor 2020) kennt Haben nicht; solche Anlagen übernimmst du linear mit Restbuchwert (§ 7 Abs. 3 EStG).
 */
export const DEGRESSIVE_WINDOWS: readonly DegressiveWindow[] = [
  { from: "2020-01-01", to: "2022-12-31", factor: 2.5, cap: 2500, source: "§ 7 Abs. 2 EStG a. F. i. V. m. § 52 Abs. 15 Satz 4 EStG" },
  { from: "2024-04-01", to: "2024-12-31", factor: 2, cap: 2000, source: "§ 7 Abs. 2 EStG a. F. i. V. m. § 52 Abs. 15 Satz 4 EStG" },
  { from: "2025-07-01", to: "2027-12-31", factor: 3, cap: 3000, source: "§ 7 Abs. 2 EStG (Investitionssofortprogramm)" },
];

export const DEGRESSIVE_PERIODS_TEXT = "01.01.2020 bis 31.12.2022, 01.04.2024 bis 31.12.2024 und 01.07.2025 bis 31.12.2027";

export function degressiveWindow(acquisitionDate: string): DegressiveWindow | null {
  return DEGRESSIVE_WINDOWS.find((w) => acquisitionDate >= w.from && acquisitionDate <= w.to) ?? null;
}

/**
 * Höchster Satz in Basispunkten: das Vielfache des linearen Satzes (12 / Nutzungsdauer in Monaten), gedeckelt;
 * abgerundet, damit er die Grenze nie überschreitet. null: für das Datum nicht zulässig.
 */
export function maxDegressiveRate(acquisitionDate: string, usefulLifeMonths: number): number | null {
  const window = degressiveWindow(acquisitionDate);
  if (!window || usefulLifeMonths < 1) return null;
  return Math.min(window.cap, Math.floor((window.factor * 120_000) / usefulLifeMonths));
}

/**
 * § 7 Abs. 2a Satz 1 EStG: Elektrofahrzeuge nach § 9 Abs. 2 KraftStG, angeschafft nach dem 30.06.2025 und vor dem
 * 01.01.2028; in Prozent der Anschaffungskosten im Jahr der Anschaffung 75, danach 10, 5, 5, 3 und 2. Satz 3: ohne
 * Zwölftelung im Anschaffungsjahr (Absatz 1 Satz 4 gilt nicht).
 */
export const ELEKTRO_STAFFEL = [7500, 1000, 500, 500, 300, 200] as const;
export const ELEKTRO_FROM = "2025-07-01";
export const ELEKTRO_TO = "2027-12-31";

export const isElektroDate = (acquisitionDate: string) => acquisitionDate >= ELEKTRO_FROM && acquisitionDate <= ELEKTRO_TO;

/** Kumulierte AfA nach § 7 Abs. 2a bis einschließlich des Jahres mit Index k (0 = Anschaffungsjahr) */
export function elektroCumulative(cost: Cents, k: number): Cents {
  if (k < 0) return 0;
  const percent = ELEKTRO_STAFFEL.slice(0, k + 1).reduce((s, p) => s + p, 0);
  return Math.round((cost * percent) / 10_000);
}

/** Erinnerungswert: 1 € bleibt stehen, bis die Anlage ausscheidet (Praxis nach HGB, wahlweise je Anlage) */
export const MEMO_VALUE: Cents = 100;

/** Satz in Basispunkten als Text, z. B. 2307 → „23,07 %“ */
export function formatDegressiveRate(rate: number): string {
  return `${(rate / 100).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`;
}
