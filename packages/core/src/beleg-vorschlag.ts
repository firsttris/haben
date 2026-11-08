import { mostFrequent } from "./matching.ts";

/*
 * Vorschläge für einen Beleg aus den gebuchten Belegen desselben Lieferanten (#295), ohne KI-Modell: Die Kategorie
 * nimmt Haben schon lange von dort (die häufigste, documents.ts supplierCategory); dazu kommt die Bezahlung. Haben bucht
 * nie von selbst, der Beleg bleibt „Zu prüfen“, bis er bestätigt ist.
 */

export type Zahlweg = "bank" | "privat" | "kasse";

/**
 * Bezahlung aus früheren Belegen desselben Lieferanten: die häufigste, aber nur, wenn sie mindestens zweimal vorkam und
 * mehr als die Hälfte der Belege ausmacht. Anders als die Kategorie hat die Bezahlung eine gute Vorgabe (Geschäftskonto);
 * ein einzelner privat bezahlter Beleg soll sie nicht umstellen. `last` ist der Zeitpunkt der letzten Buchung so (ISO).
 */
export function gelernteBezahlung(
  rows: { value: Zahlweg; count: number; last: string }[],
): { value: Zahlweg; count: number; total: number; last: string } | null {
  const top = mostFrequent(rows);
  return top && top.count >= 2 && top.count * 2 > top.total ? top : null;
}
