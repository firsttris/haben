/*
 * Platzhalter in Einleitung und Hinweis von Rechnung und Angebot (#1334), auch aus Textbausteinen; aufgelöst werden sie
 * in Vorschau und beim Festschreiben (apps/web, rechnungen/beleg-platzhalter.ts). Die Namen sind die der E-Mail-Vorlagen.
 */

/** Platzhalter mit Beschreibung für die Oberfläche, in der Reihenfolge der Anzeige */
export const BELEG_PLATZHALTER = {
  art: "Art des Belegs (Rechnung, Schlussrechnung …, Angebot)",
  nummer: "Nummer, in der Vorschau eines Entwurfs die voraussichtliche",
  datum: "Rechnungs- bzw. Angebotsdatum",
  betrag: "Gesamtbetrag brutto",
  faellig: "Fälligkeit (nur Rechnung)",
  gueltig: "gültig bis (nur Angebot)",
  leistungszeitraum: "Leistungszeitraum bzw. Leistungsdatum, leer ohne Angabe",
  kunde: "Name des Kunden",
  firma: "dein Firmenname",
  iban: "IBAN deines Bankkontos aus den Firmendaten, in Vierergruppen",
  bic: "BIC deines Bankkontos aus den Firmendaten",
} as const;
