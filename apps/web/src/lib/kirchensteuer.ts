/*
 * Hinweis zur gezahlten Kirchensteuer (#1451): Zur Kirchensteuer nach § 10 Abs. 1 Nr. 4 EStG gehört auch die
 * einbehaltene Lohnkirchensteuer der Lohnsteuerbescheinigung (Nr. 6, für den Ehegatten Nr. 7). Wer nur die
 * Vorauszahlungen einträgt, hat zu niedrige Beiträge im Jahr; übersteigt dann die erstattete Kirchensteuer die
 * gezahlte, rechnet Haben den Überhang nach § 10 Abs. 4b Satz 3 EStG hinzu, den es nicht gibt, und das zu
 * versteuernde Einkommen liegt zu hoch.
 */

/** Am Eingabefeld „Gezahlte Kirchensteuer“ der Jahreserklärung */
export const KIRCHENSTEUER_HINWEIS =
  "Vorauszahlungen und Nachzahlungen, dazu die einbehaltene Lohnkirchensteuer laut Lohnsteuerbescheinigung (Nr. 6, für den Ehegatten Nr. 7); nicht die Kirchensteuer auf Kapitalerträge";

/**
 * In der Vorauszahlungs-Prognose, solange sie die Angaben des Vorjahres übernimmt: Ohne den Hinweis bleibt die
 * fehlende Lohnkirchensteuer im laufenden Jahr unbemerkt, und die Prognose rechnet den Überhang mit.
 */
export const KIRCHENSTEUER_FORTSCHREIBUNG =
  "Zur Kirchensteuer in deinen Angaben gehört auch die einbehaltene Lohnkirchensteuer laut Lohnsteuerbescheinigung (Nr. 6, für den Ehegatten Nr. 7); fehlt sie, rechnet die Prognose einen Erstattungsüberhang hinzu, den es nicht gibt (§ 10 Abs. 4b Satz 3 EStG).";
