import { type Kontenrahmen, kategorieMitKonto } from "@haben/core";

/**
 * Spalte „Art“ der Kontakthistorie bei einem Beleg: die Kategorie mit der Nummer ihres Kontos (#1438), ohne Nummer beim
 * Anlagegut und bei unbekannten Werten aus einem Import; sonst der Hinweis auf die Aufteilung oder „–“
 */
export function belegArt(beleg: { category: string | null; splitCount: number }, kontenrahmen: Kontenrahmen): string {
  if (beleg.category) return kategorieMitKonto(kontenrahmen, beleg.category);
  return beleg.splitCount > 0 ? `Aufgeteilt auf ${beleg.splitCount} Zeilen` : "–";
}
