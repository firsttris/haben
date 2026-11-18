/*
 * Hinweis zur gezahlten Kirchensteuer (#1451): Zur Kirchensteuer nach § 10 Abs. 1 Nr. 4 EStG gehört auch die
 * einbehaltene Lohnkirchensteuer der Lohnsteuerbescheinigung (Nr. 6, für den Ehegatten Nr. 7). Wer nur die
 * Vorauszahlungen einträgt, hat zu niedrige Beiträge im Jahr; übersteigt dann die erstattete Kirchensteuer die
 * gezahlte, rechnet Haben den Überhang nach § 10 Abs. 4b Satz 3 EStG hinzu, den es nicht gibt, und das zu
 * versteuernde Einkommen liegt zu hoch. Derselbe Hinweis steht in der Vorauszahlungs-Prognose, wo Haben die Angaben
 * eines früheren Jahres fortschreibt.
 */

/** Am Eingabefeld „Gezahlte Kirchensteuer“ der Jahreserklärung */
export const KIRCHENSTEUER_HINWEIS =
  "Vorauszahlungen und Nachzahlungen, dazu die einbehaltene Lohnkirchensteuer laut Lohnsteuerbescheinigung (Nr. 6); nicht die Kirchensteuer auf Kapitalerträge";

/**
 * In der Vorauszahlungs-Prognose, wenn die Abzüge aus einem früheren Jahr stammen: Die Ansicht rechnet die Angaben
 * sonst Jahr für Jahr fort, samt einer Kirchensteuer, der die Lohnkirchensteuer fehlt.
 */
export const kirchensteuerFortschreibung = (angabenAus: number, year: number): string =>
  `Die Angaben aus ${angabenAus} rechnet Haben für ${year} fort. Zur Kirchensteuer darin gehört auch die einbehaltene Lohnkirchensteuer laut Lohnsteuerbescheinigung (Nr. 6); fehlt sie, entsteht ein Erstattungsüberhang, den es nicht gibt (§ 10 Abs. 4b Satz 3 EStG).`;
