import type { BwaZeileDefinition } from "./bwa.ts";
import type { Cents } from "./money.ts";

/*
 * Was die BWA (#1380) zeigt, gemeinsam für die Seite und später den Export (#1635): ohne Schalter fehlen Zeilen, die in allen Spalten 0
 * sind, mit „Leere Zeilen anzeigen“ steht jede Zeile der Form, damit die BWA Zeile für Zeile neben die der Steuerberatung
 * passt. Summen und Ergebnis stehen immer.
 */

/** Die Beträge einer Zeile, soweit es für die Ansicht darauf ankommt; ohne Vergleich `null` */
export interface BwaZeileBetraege {
  art: BwaZeileDefinition<string, string>["art"];
  betrag: Cents;
  kumuliert: Cents;
  vergleich: Cents | null;
  vergleichKumuliert: Cents | null;
}

/** Zeile mit Beträgen, die in keiner Spalte etwas hat */
export const bwaZeileLeer = (z: BwaZeileBetraege): boolean =>
  z.art === "zeile" && z.betrag === 0 && z.kumuliert === 0 && (z.vergleich ?? 0) === 0 && (z.vergleichKumuliert ?? 0) === 0;

/** Die Zeilen in der Reihenfolge der Form; `alle` zeigt auch leere */
export function sichtbareZeilen<Z extends BwaZeileBetraege>(zeilen: readonly Z[], alle: boolean): Z[] {
  return alle ? [...zeilen] : zeilen.filter((z) => !bwaZeileLeer(z));
}
