import { direktKategorienFuer } from "./direkt-kategorie.ts";
import type { AccountPurpose } from "./matching.ts";
import { directBookingsFor, type DirectBooking } from "./posting.ts";
import type { Rechtsform } from "./rechtsform.ts";

/*
 * Angebot im Bankabgleich je Kontozweck (#873): Ein Konto mit dem Zweck „privat“ nimmt seine Umsätze weiter auf, und sie
 * bleiben zuordenbar. Vier Angebote fallen dort weg, weil sie auf einem privaten Konto keinen Geschäftsvorfall ergeben:
 *
 * - Kontoführung und Bankgebühren: Die Gebühren eines privaten Kontos sind privat, kein Betriebsaufwand (§ 12 Nr. 1 EStG).
 * - Zinserträge: Guthabenzinsen eines privaten Kontos sind Einkünfte aus Kapitalvermögen (§ 20 EStG), keine
 *   Betriebseinnahme.
 * - Privat: Eine Entnahme von einem privaten Konto wäre privat gegen privat.
 * - Geldtransit: Eine Umbuchung zwischen eigenen Konten mit einem privaten Konto auf beiden Seiten ist Entnahme gegen
 *   Entnahme.
 *
 * Mehr fällt nicht weg: Die Steuern des Betriebs bleiben von dort buchbar, gegen Entnahme bzw. Einlage
 * (server/modules/bank/steuerzahlung.ts, ustPrivatPosting). Kategorie, Rechnung und Beleg buchen dort noch gegen die Bank
 * (Rest von #873).
 */

/**
 * Die Angebote, die auf einem privaten Konto entfallen. „gebuehren“ (Buchungsart) und „geldverkehr“ (Kategorie) sind
 * dieselbe Möglichkeit in zwei Listen; deshalb fünf Schlüssel für vier sichtbare Einträge.
 */
const PRIVAT_NICHT_ANGEBOTEN = ["gebuehren", "zinsertrag", "privat", "geldtransit", "geldverkehr", "spende"] as const;

const gesperrt = (wert: string) => (PRIVAT_NICHT_ANGEBOTEN as readonly string[]).includes(wert);

/** Ob eine Buchungsart oder Kategorie auf einem Konto mit diesem Zweck gebucht werden darf; der Server prüft damit jede Zuordnung */
export function aufKontoAngeboten(wert: string, zweck: AccountPurpose | null): boolean {
  return zweck !== "privat" || !gesperrt(wert);
}

/** Buchungen ohne Beleg für ein Konto; auf einem privaten Konto ohne die vier, die dort keinen Sinn ergeben (#873) */
export function direktBuchungenFuerKonto(rechtsform: Rechtsform, zweck: AccountPurpose | null): DirectBooking[] {
  const arten = directBookingsFor(rechtsform);
  return arten.filter((art) => aufKontoAngeboten(art, zweck));
}

/** Kategorien unter „Direkt buchen“ für ein Konto; auf einem privaten Konto ohne Bankgebühren (#873) */
export function direktKategorienFuerKonto(zweck: AccountPurpose | null): ReturnType<typeof direktKategorienFuer> {
  const kategorien = direktKategorienFuer();
  return kategorien.filter((kategorie) => aufKontoAngeboten(kategorie.value, zweck));
}
