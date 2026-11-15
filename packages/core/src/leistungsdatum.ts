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

/**
 * Beim Buchen ist die Leistung noch nicht ausgeführt: Das Leistungsdatum liegt nach dem Belegdatum. Die Vorsteuer ist
 * dann noch nicht abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 UStG, beide Voraussetzungen müssen erfüllt sein) und bleibt bis
 * zum Ausgleich geparkt. Der Vergleich läuft über die Schreibweise, nicht über Zahlen.
 */
export function leistungNichtAusgefuehrt(angabe: Leistungsangabe): boolean {
  return leistungsdatum(angabe).localeCompare(angabe.belegdatum) > 0;
}
