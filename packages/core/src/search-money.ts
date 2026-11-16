import { parseEuro } from "./money.ts";

/** Bereich in Cent, beide Grenzen eingeschlossen */
export interface CentRange {
  min: number;
  max: number;
}

const INT4_MAX = 2_147_483_647;

/**
 * Erkennt Euro-Eingaben für die Suche („119“, „119,50“, „1.234,56 €“, „19.99“) über parseEuro, also wie die Betragsfelder
 * (#1242), als Bereich in Cent: mit Cent genau dieser Betrag, als ganzer Euro alle Cent-Beträge dieses Euros („1190“ →
 * 1.190,00 bis 1.190,99 €, „-1190“ → -1.190,99 bis -1.190,00 €). Nicht-Beträge (wie „RE-2026“ oder „12€50“) liefern null,
 * ebenso Bereiche, die mit beiden Vorzeichen nicht in PostgreSQL-int4 passen: die Suche vergleicht beim Bankumsatz auch den
 * Gegenwert.
 *
 * Entschieden (#1038): Verglichen wird nur der Bruttobetrag bzw. der gezahlte Betrag, nicht netto (gesucht wird fast immer
 * eine Zahl vom Kontoauszug, Beleg oder aus einer Nachricht; netto findet man über den Namen schneller) und nicht der
 * offene Rest einer Teilzahlung; ungefähr (±1 € oder ±%) auch nicht. Nicht nachrüsten, ohne das neu zu entscheiden.
 */
export function parseEuroSearchRange(query: string): CentRange | null {
  const cents = parseEuro(query);
  if (cents === null) return null;
  // Hat parseEuro gelesen, stehen Nachkommastellen hinter einem Komma oder hinter einem Punkt mit ein bis zwei Ziffern
  // („12.50“); „1.500“ sind Tausender. Ein Minus steht dann nur vorn, auch bei „-0“.
  const ganzerEuro = !/[,.]\d{1,2}(?!\d)/.test(query);
  const negativ = /[-−–]/.test(query);
  const range = !ganzerEuro ? { min: cents, max: cents } : negativ ? { min: cents - 99, max: cents } : { min: cents, max: cents + 99 };
  return Math.max(Math.abs(range.min), Math.abs(range.max)) > INT4_MAX ? null : range;
}

/** Ob ein Betrag in Cent im Bereich liegt; ohne Betrag nie */
export function inCentRange(range: CentRange, cents: number | null | undefined): boolean {
  return cents !== null && cents !== undefined && cents >= range.min && cents <= range.max;
}
