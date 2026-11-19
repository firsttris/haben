/** Wie viele Umsätze eine Sammelbestätigung höchstens umfasst (#1440); Server und Liste verwenden dieselbe Zahl */
export const BESTAETIGEN_HOECHSTENS = 200;

/** Die Umsätze, die „Alle markieren“ setzt: höchstens so viele, wie der Server auf einmal bucht */
export const ersteMarkierbare = <T>(ids: readonly T[]): T[] => ids.slice(0, BESTAETIGEN_HOECHSTENS);

/** Ob mehr Umsätze markiert sind, als eine Sammelbestätigung bucht (etwa von Hand einzeln markiert) */
export const zuVieleMarkiert = (anzahl: number): boolean => anzahl > BESTAETIGEN_HOECHSTENS;
