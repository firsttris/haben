import { gleicheSalden } from "./gegenbuchung.ts";
import type { JournalZeile } from "./journal-kennzahlen.ts";
import { ACCOUNTS, type Kontenrahmen, type PostingLine } from "./posting.ts";

/*
 * Zahlungen auf Ausgangsrechnungen bei Ist-Versteuerung aus Versionen vor #552 (bis v0.6) tragen keine
 * Bemessungsgrundlage (#1502): Die Umbuchung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ steht da, `basis` an der
 * Umsatzsteuerzeile und der Steuerschlüssel des Anteils zu 0 % an der Forderung fehlen. Aus dem Journal meldete die
 * Voranmeldung dann die Steuer ohne ihre Bemessungsgrundlage (Kz 81, 86, 48 …), obwohl bei Ist Steuer und Entgelt mit
 * Ablauf des Voranmeldungszeitraums der Vereinnahmung entstehen (§ 13 Abs. 1 Nr. 1 Buchst. b, § 20 UStG). Bis 0.9
 * rechneten diese Jahre aus dem Nebenbuch und meldeten richtig.
 *
 * Gebuchte Zeilen bleiben, wie sie sind (GoBD); beim Lesen bekommt die Zahlung Forderungs- und Steuerzeilen, wie Haben sie
 * heute aus Rechnung und Anteil bucht, wenn diese auf jedem dieser Konten denselben Saldo ergeben. Die Geldzeile bleibt die
 * gebuchte: Bank, Kasse oder Verrechnungskonto eines Zahlungsdienstleisters. Trägt eine Zeile schon eine
 * Bemessungsgrundlage, ist die Zahlung im heutigen Format gebucht und bleibt, wie sie ist. Der Aufrufer wendet die Funktion
 * nur auf Zahlungen an, die vor dem Update auf das Journal angelegt wurden, und ihre Stornos (zahlungAusAlterVersion in
 * apps/web); eine neue Zahlung ohne Bemessungsgrundlage wäre ein Fehler, den die Verprobung zeigen soll.
 */

/** Die Zeilen einer Zahlung auf eine Rechnung, bei einer Buchung von vor #552 mit der Bemessungsgrundlage wie heute */
export function zahlungMitBemessungWieHeute(kontenrahmen: Kontenrahmen, gebucht: readonly JournalZeile[], heute: readonly PostingLine[]): JournalZeile[] {
  if (gebucht.some((z) => z.basis != null)) return [...gebucht];
  const a = ACCOUNTS[kontenrahmen];
  const konten: ReadonlySet<string> = new Set([a.forderungen, ...Object.values(a.ust), ...Object.values(a.ustNichtFaellig)]);
  const steuerteil = <Z extends { account: string }>(zeilen: readonly Z[]) => zeilen.filter((z) => konten.has(z.account));
  const heuteSteuerteil = steuerteil(heute);
  if (!heuteSteuerteil.some((z) => z.basis != null)) return [...gebucht];
  if (!gleicheSalden(steuerteil(gebucht) as PostingLine[], heuteSteuerteil)) return [...gebucht];
  return [...gebucht.filter((z) => !konten.has(z.account)), ...heuteSteuerteil];
}
