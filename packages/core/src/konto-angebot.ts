import { AUFLADUNG, direktKategorienFuer } from "./direkt-kategorie.ts";
import type { AccountPurpose } from "./matching.ts";
import { directBookingsFor, type DirectBooking } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

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
 * Mehr fällt nicht weg: Was bleibt, bucht auf einem privaten Konto gegen die Richtung des Zahlungskontos, also gegen
 * Privatentnahme, Privateinlage oder das Gesellschafter-Verrechnungskonto statt gegen die Bank (posting.ts,
 * privatKontoPosting; angewandt in server/modules/bank/allocation.ts). Das gilt für Steuern, Kategorie, Aufladung, Rechnung,
 * Beleg, Darlehen und die Lohnzahlungen gleichermaßen.
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

/**
 * Die Aufladung eines Guthabens (#1356) gibt es nur im Einzelunternehmen: Dort ist die Zahlung im Monat der Zahlung
 * Betriebsausgabe (§ 11 Abs. 2 EStG). Eine Gesellschaft mit Bilanz weist den Betrag bis zur Rechnung als Anzahlung bzw.
 * sonstige Forderung aus (§ 246 Abs. 1 HGB); als Aufwand gebucht wäre sie dort falsch. Deshalb bietet Haben die
 * Zuordnungsart in GmbH und UG nicht an und bucht sie nicht; die Aktivierung bleibt #1281.
 */
const NUR_EINZELUNTERNEHMEN = [AUFLADUNG.kind] as const;

/** Ob eine Buchungsart in dieser Rechtsform gebucht werden darf; der Server prüft damit jede Zuordnung */
export function aufRechtsformAngeboten(wert: string, rechtsform: Rechtsform): boolean {
  return !isKapitalgesellschaft(rechtsform) || !(NUR_EINZELUNTERNEHMEN as readonly string[]).includes(wert);
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

/**
 * Buchungsarten, die nicht aus dem Angebot des Kontos stammen, sondern immer zur Wahl stehen: Kategorie, Aufladung,
 * Steuer und Darlehen. Sie hängen nicht am Kontozweck; auf einem privaten Konto buchen sie wie jede andere Art gegen
 * Entnahme, Einlage oder das Gesellschafter-Verrechnungskonto (privatKontoPosting, #873).
 */
export const FREIE_BUCHUNGSARTEN = ["kategorie", "aufladung", "steuer", "darlehen"] as const;

/**
 * Startwert für „Buchen als“: der Vorschlag, wenn das Konto ihn anbietet, sonst der erste erlaubte Eintrag. Der
 * Vorschlag aus einer früheren Direktbuchung ist eine Kategorie (#295); sie steht nicht im Angebot der Buchungsarten
 * und fiel deshalb auf „Privat“ zurück — auch dort, wo „Privat“ gar nicht zur Wahl steht (#873).
 */
export function startwertFuerBuchungsart(vorschlag: string | undefined, angeboteneArten: readonly string[]): string {
  const frei = vorschlag !== undefined && (FREIE_BUCHUNGSARTEN as readonly string[]).includes(vorschlag);
  if (vorschlag !== undefined && (frei || angeboteneArten.includes(vorschlag))) return vorschlag;
  return angeboteneArten[0] ?? "kategorie";
}
