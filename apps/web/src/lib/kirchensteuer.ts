/*
 * Hinweis zur gezahlten Kirchensteuer (#1451): Zur Kirchensteuer nach § 10 Abs. 1 Nr. 4 EStG gehört auch die
 * einbehaltene Lohnkirchensteuer der Lohnsteuerbescheinigung. Sie steht dort in Nr. 6 und 7 (laufender Arbeitslohn,
 * Nr. 7 nur bei Konfessionsverschiedenheit) und in Nr. 13 und 14 (ermäßigt besteuerte sonstige Bezüge). Wer sie im
 * Feld vergisst, trägt zu niedrige Beiträge ein; die Prognose weist dann einen Erstattungsüberhang aus, den es nicht
 * gibt, oder setzt einen bestehenden zu hoch an (§ 10 Abs. 4b Satz 3 EStG), und das zu versteuernde Einkommen liegt
 * zu hoch.
 */

/** Am Eingabefeld „Gezahlte Kirchensteuer“ der Jahreserklärung */
export const KIRCHENSTEUER_HINWEIS =
  "Vorauszahlungen und Nachzahlungen, dazu die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bei sonstigen Bezügen Nr. 13 und 14); nicht die Kirchensteuer auf Kapitalerträge";

/**
 * In der Vorauszahlungs-Prognose, solange sie die Angaben des Vorjahres übernimmt: Ohne den Hinweis bleibt die
 * fehlende Lohnkirchensteuer im laufenden Jahr unbemerkt, und die Prognose rechnet den Überhang mit.
 */
export const KIRCHENSTEUER_FORTSCHREIBUNG =
  "Zur Kirchensteuer in deinen Angaben gehört auch die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bei sonstigen Bezügen Nr. 13 und 14); fehlt sie, kann die Prognose einen Erstattungsüberhang ausweisen oder zu hoch ansetzen (§ 10 Abs. 4b Satz 3 EStG).";
