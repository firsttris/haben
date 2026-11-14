import { monthsOfPeriod, type VatPeriod } from "@haben/core";

/** Ein bereits übermittelter Voranmeldungszeitraum; `month` ist der Zeitraum, nicht der Monat (Q1 = 41) */
export interface GemeldeterZeitraum {
  year: number;
  month: number;
}

/**
 * Liegt der Tag in einem Zeitraum, dessen Voranmeldung schon übermittelt ist? Gibt diesen Zeitraum zurück, sonst null.
 *
 * Bei Soll-Versteuerung entscheidet der Leistungstag, in welcher Anmeldung die Umsatzsteuer steht. Ist diese Anmeldung
 * schon raus, lässt sie sich nicht mehr ändern: Die Buchung bleibt am Leistungstag, die Steuer erscheint dort aber nicht
 * mehr. Das ist kein Fehler, den man verhindern darf — eine Rechnung darf auch nach der Abgabe geschrieben werden.
 */
export function gemeldeterZeitraum(tag: string, zeitraeume: GemeldeterZeitraum[]): GemeldeterZeitraum | null {
  const [jahr, monat] = tag.split("-").map(Number);
  for (const zeitraum of zeitraeume) {
    if (zeitraum.year !== jahr) continue;
    if (monthsOfPeriod(zeitraum as VatPeriod).some((teil) => teil.month === monat)) return zeitraum;
  }
  return null;
}

/** „Q2/2026" für ein Quartal, „05/2026" für einen Monat */
export function zeitraumLabel({ year, month }: GemeldeterZeitraum): string {
  if (month > 12) return `Q${month - 40}/${year}`;
  return `${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Hinweis für das Festschreiben: Der Leistungsmonat liegt in einer schon übermittelten Voranmeldung.
 * Bewusst ein Hinweis und keine Sperre (#694): Die Rechnung ist gültig, die Steuer wandert nur in die nächste Anmeldung.
 */
export function leistungsmonatHinweis(serviceDate: string | null, zeitraeume: GemeldeterZeitraum[]): string | null {
  if (!serviceDate) return null;
  const zeitraum = gemeldeterZeitraum(serviceDate, zeitraeume);
  if (!zeitraum) return null;
  const [jahr, monat] = serviceDate.split("-").map(Number);
  return (
    `Der Leistungsmonat ${String(monat).padStart(2, "0")}/${jahr} liegt in der bereits übermittelten Voranmeldung ` +
    `${zeitraumLabel(zeitraum)}. Die Buchung bleibt am Leistungstag, die Umsatzsteuer dieser Rechnung ist dort aber ` +
    `nicht mehr enthalten — sie gehört in die nächste Voranmeldung.`
  );
}
