/*
 * Hinweis zur gezahlten Kirchensteuer (#1451): Zur Kirchensteuer nach § 10 Abs. 1 Nr. 4 EStG gehört auch die
 * einbehaltene Lohnkirchensteuer der Lohnsteuerbescheinigung. Sie steht dort in Nr. 6 und in Nr. 7 (der Anteil aus
 * dem eigenen Lohn für die Kirche des Ehegatten, bei Konfessionsverschiedenheit) sowie in Nr. 13 und 14 für
 * ermäßigt besteuerte sonstige Bezüge — die Felder sind im Muster für 2026 unbesetzt, weil die Fünftelregelung im
 * Lohnsteuerabzug entfallen ist; Bescheinigungen bis 2024 weisen sie aus. Daneben ist ein gezahltes Kirchgeld
 * abziehbar. Wer das vergisst, trägt zu niedrige Beiträge ein; die Prognose kann dann einen
 * Erstattungsüberhang ausweisen oder einen bestehenden zu hoch ansetzen (§ 10 Abs. 4b Satz 3 EStG),
 * und das zu versteuernde Einkommen liegt zu hoch.
 * Nicht abziehbar ist nur die Kirchensteuer zur Abgeltungsteuer: der Zuschlag zur Kapitalertragsteuer und zur
 * Steuer nach dem gesonderten Tarif des § 32d Abs. 1 EStG (Halbsatz 2 der Nummer 4).
 */

/** Am Eingabefeld „Gezahlte Kirchensteuer“ der Jahreserklärung */
export const KIRCHENSTEUER_HINWEIS =
  "Vorauszahlungen, Nachzahlungen und Kirchgeld, dazu die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bis 2024 bei sonstigen Bezügen auch Nr. 13 und 14); nicht die Kirchensteuer zur Abgeltungsteuer";

/**
 * In der Vorauszahlungs-Prognose, solange sie die Angaben des Vorjahres übernimmt: Ohne den Hinweis bleibt die
 * fehlende Lohnkirchensteuer im laufenden Jahr unbemerkt, und die Prognose rechnet den Überhang mit.
 */
export const KIRCHENSTEUER_FORTSCHREIBUNG =
  "Zur Kirchensteuer in deinen Angaben gehört auch die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bis 2024 bei sonstigen Bezügen auch Nr. 13 und 14); fehlt sie, kann die Prognose einen Erstattungsüberhang ausweisen oder zu hoch ansetzen (§ 10 Abs. 4b Satz 3 EStG).";
