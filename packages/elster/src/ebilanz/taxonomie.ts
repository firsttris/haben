import type { Cents } from "@haben/core";
import taxonomie69 from "./taxonomie-6-9.json" with { type: "json" };
import taxonomie610 from "./taxonomie-6-10.json" with { type: "json" };

/*
 * Die HGB-Taxonomien, in denen Haben die E-Bilanz übermittelt, als Auszug je Position (scripts/ebilanz/taxonomie.ts), und
 * welche für ein Wirtschaftsjahr gilt.
 */

export type EbilanzTaxonomie = "6.9" | "6.10";

/** [Pflichtgrad, Summe, Gewicht, Soll/Haben, Periodentyp] je Position; Pflichtgrad M Muss, S Summenmuss, R rechnerisch notwendig */
type Position = [req: string, parent: string | null, weight: number, balance: string, period: string];

interface Taxonomie {
  /** Datum im Namensraum der Taxonomie (de-gcd-…, de-gaap-ci-…) */
  datum: string;
  positionen: Record<string, Position>;
  /** Positionen, die eine Summe bilden (Ziel einer Rechenregel) */
  summen: Set<string>;
}

function taxonomie(datum: string, positionen: Record<string, Position>): Taxonomie {
  return { datum, positionen, summen: new Set(Object.values(positionen).flatMap(([, parent]) => (parent ? [parent] : []))) };
}

const TAXONOMIEN: Record<EbilanzTaxonomie, Taxonomie> = {
  "6.9": taxonomie("2025-04-01", taxonomie69.positionen as unknown as Record<string, Position>),
  "6.10": taxonomie("2026-04-01", taxonomie610.positionen as unknown as Record<string, Position>),
};

export class EbilanzError extends Error {}

/**
 * Taxonomie für das Wirtschaftsjahr (= Kalenderjahr). BMF-Schreiben vom 8. Juni 2026 (IV C 6 - S 2133-b/00067/002/023):
 * 6.10 grundsätzlich für Wirtschaftsjahre, die nach dem 31. Dezember 2026 beginnen; für 2026 nur „nicht beanstandet“.
 * Für 2026 und früher bleibt es deshalb bei 6.9 (BMF-Schreiben vom 10. Juni 2025, BStBl I S. 1450: grundsätzlich ab
 * 2026, für 2025 nicht beanstandet), die auch ERiC 44 prüft und mit ERiC 45.1 als Echtfall sendet; 6.10 nimmt ERiC 45.1
 * nur mit Testmerker an (ERiC-Releasenotes 45.1, Kap. 3.1.8).
 */
export function ebilanzTaxonomie(year: number): EbilanzTaxonomie {
  return year >= 2027 ? "6.10" : "6.9";
}

/** Datum im Namensraum der Taxonomie, z. B. 2026-04-01 für 6.10 */
export function ebilanzTaxonomieDatum(version: EbilanzTaxonomie): string {
  return TAXONOMIEN[version].datum;
}

export function ebilanzPositionen(version: EbilanzTaxonomie): Readonly<Record<string, Position>> {
  return TAXONOMIEN[version].positionen;
}

function position(version: EbilanzTaxonomie, name: string): Position {
  const p = TAXONOMIEN[version].positionen[name];
  if (!p) throw new EbilanzError(`Position ${name} gibt es in der Taxonomie ${version} nicht`);
  return p;
}

/** Soll/Haben der Position: debit oder credit */
export function ebilanzSaldoSeite(version: EbilanzTaxonomie, name: string): string {
  return position(version, name)[3];
}

/** Summen nach den Rechenregeln: jede Position mit Wert gibt ihn, mit Gewicht, an ihre Summe weiter */
export function ebilanzSummen(werte: Readonly<Record<string, Cents>>, version: EbilanzTaxonomie): Map<string, Cents> {
  const result = new Map<string, Cents>();
  for (const [name, value] of Object.entries(werte)) {
    position(version, name);
    if (value === 0) continue;
    let current: string | null = name;
    let factor = 1;
    while (current) {
      result.set(current, (result.get(current) ?? 0) + factor * value);
      const [, parent, weight]: Position = position(version, current);
      factor *= weight;
      current = parent;
    }
  }
  return result;
}

/**
 * Positionen, die einen Wert tragen dürfen: ohne Unterpositionen mit Pflichtgrad (Muss, Summenmuss, rechnerisch
 * notwendig). Freiwillige Unterpositionen, etwa die Entwicklung des gezeichneten Kapitals, dürfen leer bleiben.
 */
export function istEbilanzBlatt(name: string, version: EbilanzTaxonomie): boolean {
  const { positionen } = TAXONOMIEN[version];
  if (!positionen[name]) return false;
  return !Object.values(positionen).some(([req, parent]) => req !== "" && parent === name);
}

/** Kette der Summen bis zur Wurzel (bs.ass, bs.eqLiab, is.netIncome) */
export function ebilanzSummenkette(name: string, version: EbilanzTaxonomie): string[] {
  const chain: string[] = [];
  for (let p: string | null = name; p; p = TAXONOMIEN[version].positionen[p]?.[1] ?? null) chain.push(p);
  return chain;
}

/** Steht die Position in einer Rechenregel, als Summand oder als Summe? Davon-Vermerke etwa stehen in keiner. */
export function istRechnerischVerknuepft(name: string, version: EbilanzTaxonomie): boolean {
  const t = TAXONOMIEN[version];
  return Boolean(t.positionen[name]?.[1]) || t.summen.has(name);
}
