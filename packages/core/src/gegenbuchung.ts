import type { Cents } from "./money.ts";
import type { PostingLine } from "./posting.ts";

/*
 * Gegenbuchung einer Buchung aus der Zeit vor dem Stichjahr (#542, docs/adr/journal-als-quelle.md): Ältere Buchungen
 * tragen teils noch keine Bemessungsgrundlage an der Zahlung (#552) oder keinen Steuerschlüssel am privaten Teil bei § 13b
 * und Erwerb (#551). Ihr Storno im Stichjahr kopierte diese Lücke in die Voranmeldung aus dem Journal. Deshalb bucht der
 * Storno die Zeilen, wie Haben sie heute aus dem Nebenbuch buchen würde, wenn sie auf jedem Konto denselben Saldo ergeben;
 * sonst die gebuchten.
 */

function salden(zeilen: readonly PostingLine[]): Map<string, Cents> {
  const map = new Map<string, Cents>();
  for (const z of zeilen) map.set(z.account, (map.get(z.account) ?? 0) + z.debit - z.credit);
  for (const [konto, saldo] of map) if (saldo === 0) map.delete(konto);
  return map;
}

/** Ergeben beide Zeilenfolgen auf jedem Konto denselben Saldo? */
export function gleicheSalden(a: readonly PostingLine[], b: readonly PostingLine[]): boolean {
  const sa = salden(a);
  const sb = salden(b);
  return sa.size === sb.size && [...sa].every(([konto, saldo]) => sb.get(konto) === saldo);
}

/** Die Zeilen im heutigen Format, wenn sie auf jedem Konto dasselbe buchen wie die gebuchten; sonst die gebuchten */
export function zeilenWieHeute(gebucht: readonly PostingLine[], heute: readonly PostingLine[]): PostingLine[] {
  return gleicheSalden(gebucht, heute) ? [...heute] : [...gebucht];
}
