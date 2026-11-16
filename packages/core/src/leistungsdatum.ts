import type { Cents } from "./money.ts";

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
 * dann noch nicht abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 UStG, beide Voraussetzungen müssen erfüllt sein), außer für einen
 * vorher gezahlten Anteil (UStAE 15.3 Abs. 1 Satz 2). Der Vergleich läuft über die Schreibweise, nicht über Zahlen.
 */
export function leistungNichtAusgefuehrt(angabe: Leistungsangabe): boolean {
  return leistungsdatum(angabe).localeCompare(angabe.belegdatum) > 0;
}

/** Was am Beleg darüber entscheidet, ob seine Vorsteuer bis zur Ausführung wartet */
export interface WarteAngabe {
  belegdatum: string | null;
  leistungVon?: string | null;
  leistungBis?: string | null;
  reverseCharge: string | null;
  category: string | null;
  gross: Cents;
  erstattetBezahltes: boolean;
}

/**
 * Wartet die Vorsteuer dieses Eingangsbelegs bis zur Ausführung der Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 UStG)? Nur bei
 * einem Leistungsdatum nach dem Belegdatum. § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren
 * eigenen Zeitpunkt; eine Gutschrift berichtigt nach § 17 Abs. 1 UStG im Zeitraum der Änderung, also nach Belegdatum
 * bzw. mit dem Ausgleich („erstattet bereits Bezahltes“). Die Zahlungsart prüft der Aufrufer.
 */
export function vorsteuerWartetAufAusfuehrung(b: WarteAngabe): boolean {
  if (!b.belegdatum) return false;
  if (b.reverseCharge || b.category === "einfuhrumsatzsteuer") return false;
  if (b.erstattetBezahltes || b.gross < 0) return false;
  return leistungNichtAusgefuehrt({ belegdatum: b.belegdatum, leistungVon: b.leistungVon, leistungBis: b.leistungBis });
}
