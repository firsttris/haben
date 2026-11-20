/** Wie viele Umsätze eine Sammelbestätigung höchstens umfasst (#1440); Server und Liste verwenden dieselbe Zahl */
export const BESTAETIGEN_HOECHSTENS = 200;

/** Die Umsätze, die „Alle markieren“ setzt: höchstens so viele, wie der Server auf einmal bucht */
export const ersteMarkierbare = <T>(ids: readonly T[]): T[] => ids.slice(0, BESTAETIGEN_HOECHSTENS);

/**
 * Schaltet die Markierung eines Umsatzes um. Mehr als BESTAETIGEN_HOECHSTENS lassen sich nicht markieren: `voll` meldet,
 * dass ein weiterer Haken abgelehnt wurde, damit die Liste es sagen kann.
 */
export function umschalten(markiert: ReadonlySet<string>, id: string): { markiert: ReadonlySet<string>; voll: boolean } {
  const next = new Set(markiert);
  if (next.delete(id)) return { markiert: next, voll: false };
  if (next.size >= BESTAETIGEN_HOECHSTENS) return { markiert, voll: true };
  next.add(id);
  return { markiert: next, voll: false };
}
