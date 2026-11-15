// Beträge in Cent. § 19 Abs. 1 UStG: Überschreiten, nicht Erreichen.
// https://www.gesetze-im-internet.de/ustg_1980/__19.html
export const VORJAHRESGRENZE = 2_500_000;
export const JAHRESGRENZE = 10_000_000;
const WARNANTEIL = 0.8;

export type UmsatzgrenzeBestaetigung = { umsatz: number; rechnung: number; grenze: number; vorjahresumsatz?: number };

/** Bei älteren Firmendaten kann nur das Jahr bekannt sein. */
export function companyFoundingYear(company: { foundedOn: string | null; foundingYear: number | null }): number | null {
  return company.foundedOn ? Number(company.foundedOn.slice(0, 4)) : company.foundingYear;
}

/** UStAE 19.1 Abs. 3: im Kalenderjahr der Tätigkeitsaufnahme gelten 25.000 €. */
export function umsatzgrenzeImJahr(jahr: number, foundingYear: number | null): number {
  return jahr === foundingYear ? VORJAHRESGRENZE : JAHRESGRENZE;
}

export function umsatzgrenzeNahe(umsatz: number, grenze: number): boolean {
  return umsatz >= grenze * WARNANTEIL;
}
