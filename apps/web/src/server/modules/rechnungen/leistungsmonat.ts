import { formatEuro, monthsOfPeriod, type VatPeriod } from "@haben/core";

/** Ein bereits übermittelter Voranmeldungszeitraum; `month` ist der Zeitraum, nicht der Monat (Q1 = 41) */
export interface GemeldeterZeitraum {
  year: number;
  month: number;
  sentAt?: Date | null;
}

/** Liegt der Tag in einem Zeitraum, dessen Voranmeldung schon übermittelt ist? Gibt diesen Zeitraum zurück, sonst null. */
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

const deutsch = (tag: string) => tag.split("-").reverse().join(".");

/**
 * Hinweis statt Sperre (#694): Die Meldung der Rechnung gehört in einen Zeitraum, dessen Voranmeldung schon übermittelt
 * ist. Eine spätere Voranmeldung enthält sie nicht, weil Haben nach dem Leistungstag zuordnet; die übermittelte ist zu
 * berichtigen (§ 18b Satz 5 UStG, § 153 Abs. 1 AO).
 */
export function leistungsmonatHinweis(tag: string, zeitraeume: GemeldeterZeitraum[], betrag: { net: number; tax: number }): string | null {
  const zeitraum = gemeldeterZeitraum(tag, zeitraeume);
  if (!zeitraum) return null;
  const label = zeitraumLabel(zeitraum);
  const abgabe = zeitraum.sentAt ? `, übermittelt am ${deutsch(zeitraum.sentAt.toISOString().slice(0, 10))}` : "";
  return (
    `Die Leistung vom ${deutsch(tag)} gehört in die Voranmeldung ${label}${abgabe}. Dort fehlt diese Rechnung ` +
    `(netto ${formatEuro(betrag.net)}, Umsatzsteuer ${formatEuro(betrag.tax)}), und keine spätere Voranmeldung enthält sie. ` +
    `Lege unter Umsatzsteuer für ${label} eine berichtigte Anmeldung an.`
  );
}
