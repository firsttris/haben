// Beträge in Cent. § 19 Abs. 1 UStG: Überschreiten, nicht Erreichen.
// https://www.gesetze-im-internet.de/ustg_1980/__19.html
export const VORJAHRESGRENZE = 2_500_000;
export const JAHRESGRENZE = 10_000_000;
const WARNANTEIL = 0.8;

export type UmsatzgrenzeBestaetigung = { umsatz: number; rechnung: number; grenze: number; vorjahresumsatz?: number };

export function umsatzgrenzeNahe(umsatz: number, grenze: number): boolean {
  return umsatz >= grenze * WARNANTEIL;
}
