/**
 * Leistungsdatum eines Belegs (#693, #694, #622).
 *
 * „Ausgeführt am“ ist der letzte Tag des Leistungszeitraums. Steht nur der Anfang („Leistung von“), gilt dieser Tag;
 * ohne Angabe das Beleg- bzw. Rechnungsdatum. Eine Stelle für alle, die das Datum brauchen: Vorsteuerzuordnung am Beleg,
 * Umsatzsteuer der Ausgangsrechnung im Monat der Leistung und der Umrechnungskurs, der heute schon so rechnet.
 *
 * Bestehende Belege haben kein Leistungsdatum; sie zählen damit unverändert nach Belegdatum.
 */
export interface Leistungsangabe {
  /** Beleg- bzw. Rechnungsdatum (YYYY-MM-DD) */
  belegdatum: string;
  /** Erster Tag des Leistungszeitraums, optional */
  leistungVon?: string | null;
  /** Letzter Tag des Leistungszeitraums, optional */
  leistungBis?: string | null;
}

/** Tag, an dem die Leistung ausgeführt wurde; Grundlage der Vorsteuer- und Umsatzsteuerzuordnung */
export function leistungsdatum({ belegdatum, leistungVon, leistungBis }: Leistungsangabe): string {
  return leistungBis ?? leistungVon ?? belegdatum;
}
