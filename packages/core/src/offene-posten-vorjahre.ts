import type { Cents } from "./money.ts";

/*
 * Offene Posten und das gewählte Jahr (#1110): Die drei Tabellen der offenen Posten zeigen den Stand von heute,
 * unabhängig vom gewählten Jahr. Damit beim Abschluss sichtbar ist, was aus früheren Jahren stammt, kennzeichnet
 * die Seite diese Posten und zählt sie über der Tabelle.
 *
 * Bewusst ohne Satz zur Abschlusskontrolle: Ob ein Vorjahresposten dort hingehört, hängt von der Rechtsform ab.
 * Bei GmbH und UG steht eine offene Forderung aus 2025 am 31.12.2026 in Inventar und Bilanz (§ 240 Abs. 2,
 * § 242 HGB); in der EÜR wirkt ein offener Posten gar nicht auf den Gewinn (§ 4 Abs. 3, § 11 EStG).
 */

/** Was die Kennzeichnung je Posten braucht: Datum der Entstehung und der noch offene Betrag */
export interface VorjahresPosten {
  date: string;
  open: Cents;
}

export interface VorjahresStand {
  /** Zahl der offenen Posten mit Datum vor dem gewählten Jahr */
  anzahl: number;
  /** Summe ihrer offenen Beträge */
  betrag: Cents;
  /** Zeile über der Tabelle; null, wenn nichts aus früheren Jahren offen ist */
  text: string | null;
}

/** Jahr eines Datums (JJJJ-MM-TT); 0, wenn keins dasteht – das gehört dann zu keinem Jahr */
export function jahrVonDatum(datum: string): number {
  const jahr = Number(datum.slice(0, 4));
  return Number.isInteger(jahr) && jahr > 0 ? jahr : 0;
}

/** Liegt das Datum vor dem gewählten Jahr? Ein Datum im gewählten Jahr selbst zählt nicht. */
export function istVorjahr(datum: string, jahr: number): boolean {
  const eigenes = jahrVonDatum(datum);
  return eigenes > 0 && eigenes < jahr;
}

/** Kennzeichnung in der Zeile, etwa „aus 2025“; null im gewählten Jahr */
export function vorjahresVermerk(datum: string, jahr: number): string | null {
  return istVorjahr(datum, jahr) ? `aus ${jahrVonDatum(datum)}` : null;
}

/** Zählt und summiert, was vor dem gewählten Jahr entstanden und noch offen ist */
export function vorjahresStand(posten: readonly VorjahresPosten[], jahr: number): VorjahresStand {
  const vorjahre = posten.filter((p) => istVorjahr(p.date, jahr));
  return {
    anzahl: vorjahre.length,
    betrag: vorjahre.reduce((summe, p) => summe + p.open, 0),
    text: vorjahresText(vorjahre.length),
  };
}

function vorjahresText(anzahl: number): string | null {
  if (anzahl === 0) return null;
  return anzahl === 1 ? "1 offener Posten aus einem früheren Jahr" : `${anzahl} offene Posten aus früheren Jahren`;
}
